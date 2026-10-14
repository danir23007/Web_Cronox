import { createServer, type AddressInfo, type Socket } from 'node:net';
import { SMTPServer } from 'smtp-server';
import { boundedSmtpTransport } from './bounded-smtp-transport';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const inertMessage = {
  from: 'sender@example.invalid',
  to: 'recipient@example.invalid',
  subject: 'Loopback-only tracking transport fixture',
  text: 'Synthetic content; this server never relays or delivers messages.',
};

describe('bounded SMTP with real loopback sockets and no external delivery', () => {
  it('destroys the real TCP socket when the server withholds its SMTP greeting', async () => {
    const connected = deferred<void>();
    const closed = deferred<void>();
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on('error', () => undefined);
      socket.once('close', () => {
        sockets.delete(socket);
        closed.resolve();
      });
      connected.resolve();
      // Deliberately send no greeting: the transport must cancel this socket.
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const port = (server.address() as AddressInfo).port;
    const started = Date.now();
    const bounded = boundedSmtpTransport(
      { host: '127.0.0.1', port, secure: false },
      started + 250,
    );
    try {
      const outcome = bounded.transport
        .sendMail(inertMessage)
        .catch((error) => error);
      await connected.promise;
      const error = await outcome;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('SMTP_TRACKING_DEADLINE');
      await closed.promise;
      expect(sockets.size).toBe(0);
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      bounded.dispose();
      sockets.forEach((socket) => socket.destroy());
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('opens no socket when the absolute deadline has expired before connection', async () => {
    let connections = 0;
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      connections++;
      sockets.add(socket);
      socket.on('error', () => undefined);
      socket.once('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const bounded = boundedSmtpTransport(
      {
        host: '127.0.0.1',
        port: (server.address() as AddressInfo).port,
        secure: false,
      },
      Date.now() - 1,
    );
    try {
      await expect(
        bounded.transport.sendMail(inertMessage),
      ).rejects.toMatchObject({
        message: 'SMTP_TRACKING_DEADLINE',
        deliveryUnknown: true,
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(connections).toBe(0);
      expect(sockets.size).toBe(0);
    } finally {
      bounded.dispose();
      sockets.forEach((socket) => socket.destroy());
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('closes the socket while awaiting final DATA acceptance, retaining an ambiguous outcome', async () => {
    const closed = deferred<void>();
    const dataRead = deferred<void>();
    const sockets = new Set<Socket>();
    let dataMode = false;
    let received = '';
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on('error', () => undefined);
      socket.once('close', () => {
        sockets.delete(socket);
        closed.resolve();
      });
      socket.setEncoding('utf8');
      socket.write('220 loopback.invalid ESMTP fixture\r\n');
      let pending = '';
      socket.on('data', (chunk: string) => {
        pending += chunk;
        if (dataMode) {
          received += pending;
          pending = '';
          if (received.includes('\r\n.\r\n')) dataRead.resolve();
          return;
        }
        while (pending.includes('\r\n')) {
          const index = pending.indexOf('\r\n');
          const command = pending.slice(0, index);
          pending = pending.slice(index + 2);
          if (/^(EHLO|HELO)/i.test(command))
            socket.write('250 loopback.invalid\r\n');
          else if (/^(MAIL FROM|RCPT TO)/i.test(command))
            socket.write('250 OK\r\n');
          else if (command === 'DATA') {
            dataMode = true;
            socket.write('354 End with dot\r\n');
            break;
          }
        }
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const bounded = boundedSmtpTransport(
      {
        host: '127.0.0.1',
        port: (server.address() as AddressInfo).port,
        secure: false,
        ignoreTLS: true,
      },
      Date.now() + 300,
    );
    try {
      const outcome = bounded.transport
        .sendMail(inertMessage)
        .catch((error) => error);
      await dataRead.promise;
      const error = await outcome;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('SMTP_TRACKING_DEADLINE');
      expect(error.deliveryUnknown).toBe(true);
      expect(received).toContain('Synthetic content');
      await closed.promise;
      expect(sockets.size).toBe(0);
    } finally {
      bounded.dispose();
      sockets.forEach((socket) => socket.destroy());
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('also destroys a socket after STARTTLS while the local server withholds DATA acceptance', async () => {
    const sockets = new Set<Socket>();
    const closed = deferred<void>();
    let tlsUpgrades = 0;
    let received = '';
    let messageEnded = false;
    // smtp-server supplies its built-in public test certificate. The permissive
    // certificate option below applies only to this ephemeral loopback fixture.
    const smtp = new SMTPServer({
      secure: false,
      authOptional: true,
      disableReverseLookup: true,
      disabledCommands: ['AUTH'],
      logger: false,
      onSecure(socket, _session, callback) {
        tlsUpgrades++;
        // STARTTLS replaces the server-side raw socket with a TLSSocket. Track
        // close on that actual owner as well, not solely on the old wrapper.
        sockets.clear();
        sockets.add(socket);
        socket.on('error', () => undefined);
        socket.once('close', () => {
          sockets.delete(socket);
          closed.resolve();
        });
        callback();
      },
      onData(stream) {
        stream.setEncoding('utf8');
        stream.on('data', (chunk: string) => {
          received += chunk;
        });
        stream.on('end', () => {
          messageEnded = true;
        });
        // No callback: no SMTP acceptance is generated or forwarded anywhere.
      },
    });
    smtp.on('error', () => undefined);
    smtp.server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('error', () => undefined);
      socket.once('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve));
    const bounded = boundedSmtpTransport(
      {
        host: '127.0.0.1',
        port: (smtp.server.address() as AddressInfo).port,
        secure: false,
        requireTLS: true,
        tls: { rejectUnauthorized: false },
      },
      Date.now() + 800,
    );
    try {
      const outcome = bounded.transport
        .sendMail(inertMessage)
        .catch((error) => error);
      let guard: ReturnType<typeof setTimeout> | undefined;
      const observed = await Promise.race([
        outcome.then((error) => ({ settled: true, error })),
        new Promise<{ settled: false; error?: unknown }>((resolve) => {
          guard = setTimeout(() => resolve({ settled: false }), 1200);
        }),
      ]);
      if (guard) clearTimeout(guard);
      expect({ settled: observed.settled, tlsUpgrades }).toEqual({
        settled: true,
        tlsUpgrades: 1,
      });
      const error = observed.error as Error;
      expect(error).toBeInstanceOf(Error);
      expect(messageEnded).toBe(true);
      expect(received).toContain('Synthetic content');
      let closeGuard: ReturnType<typeof setTimeout> | undefined;
      const actualConnectionClosed = await Promise.race([
        closed.promise.then(() => true),
        new Promise<boolean>((resolve) => {
          closeGuard = setTimeout(() => resolve(false), 500);
        }),
      ]);
      if (closeGuard) clearTimeout(closeGuard);
      expect(actualConnectionClosed).toBe(true);
      expect(sockets.size).toBe(0);
    } finally {
      bounded.dispose();
      sockets.forEach((socket) => socket.destroy());
      await new Promise<void>((resolve) => smtp.close(resolve));
    }
  });
});
