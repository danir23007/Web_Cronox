async page => {
  await page.goto('about:blank');
  const response = await page.request.post('http://127.0.0.1:43126/__review/access-expired');
  if (!response.ok()) throw Error('Test session missing');
  const cookie = (await page.context().cookies()).find(c => c.name === 'jwt');
  const exp = JSON.parse(Buffer.from(cookie.value.split('.')[1], 'base64url')).exp;
  if (exp > Date.now() / 1000) throw Error('Access was not expired');
  return { allStorefrontTabsClosed: page.context().pages().every(p => p.url() === 'about:blank'), expiredAccessReady: true };
}
