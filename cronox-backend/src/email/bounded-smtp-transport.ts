import { createTransport, Transporter } from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import { connect as connectNet, Socket } from 'node:net';
import { connect as connectTls } from 'node:tls';

/** Own the actual socket: Transporter.close() alone does not cancel in-flight SMTP. */
export function boundedSmtpTransport(options: SMTPTransport.Options, deadline: number): { transport: Transporter; dispose: () => void } {
  let socket: Socket | undefined;
  let expired = Date.now() >= deadline;
  const failure = () => Object.assign(Error('SMTP_TRACKING_DEADLINE'), { code: 'ETIMEDOUT', deliveryUnknown: true });
  const timer = setTimeout(() => { expired = true; socket?.destroy(failure()); }, Math.max(1, deadline - Date.now()));
  timer.unref();
  const transport = createTransport({ ...options,
    connectionTimeout: Math.min(10000, Math.max(1, deadline - Date.now())), greetingTimeout: 10000, socketTimeout: 10000,
    getSocket: (_configuration, callback) => {
      if (expired || Date.now() >= deadline) return callback(failure(), false);
      const target = { host: options.host!, port: Number(options.port || (options.secure ? 465 : 587)), ...(options.secure ? { servername: options.host } : {}) };
      socket = options.secure ? connectTls(target) : connectNet(target);
      let returned = false;
      const failed = (error: Error) => { if (!returned) { returned = true; callback(error, false); } };
      socket.once('error', failed);
      socket.once(options.secure ? 'secureConnect' : 'connect', () => {
        if (returned) return;
        returned = true;
        callback(null, { connection: socket, secured: Boolean(options.secure) });
      });
    },
  } as SMTPTransport.Options);
  return { transport, dispose: () => { clearTimeout(timer); socket?.destroy(); transport.close(); } };
}
