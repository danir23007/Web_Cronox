await page.goto(f.origin+'/admin-login.html');await page.locator('#adminLoginEmail').fill(f.users.admin.email);await page.locator('#adminLoginPassword').fill(f.password);await page.locator('#adminLoginSubmit').click();await page.waitForURL('**/admin.html**');
await openEditor();await page.locator('[name=editionReceivedAt]').fill('2026-10-25');await page.locator('#productSubmitBtn').click();await page.getByText('Cambios guardados en el lote 1.',{exact:true}).waitFor();
const saved=await state(),input=await page.locator('[name=editionReceivedAt]').inputValue();
check(input===''&&saved.lots[0].receivedAt===null,'The expected date-only bug was not reproduced');
await page.screenshot({path:'output/playwright/editions-editor-save/date-before-fix.png'});
return {reproduced:true,sentDate:'2026-10-25',inputAfterSave:input,databaseDate:saved.lots[0].receivedAt,stock:saved.product.variants.map(v=>v.stockQty)};
