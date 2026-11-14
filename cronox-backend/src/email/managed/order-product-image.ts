/** Fit the original photo inside the 70px email frame. The HTML attributes
 * carry the actual dimensions, so email clients need no object-fit support. */
export function containedOrderImage(width?: number | null, height?: number | null) {
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return {};
  const scale = Math.min(70 / width, 70 / height, 1);
  return { imageWidth: Math.max(1, Math.round(width * scale)), imageHeight: Math.max(1, Math.round(height * scale)) };
}

export function orderProductImageHtml() {
  return `<table class="order-product-frame" role="presentation" width="70" height="70" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="width:70px;height:70px;background-color:#ffffff;border:1px solid #e1e1dd;border-radius:8px;"><tr><td width="70" height="70" align="center" valign="middle" style="padding:0;text-align:center;font-size:0px;line-height:0;">{{#if imageWidth}}<img src="{{imageUrl}}" alt="{{name}}" width="{{imageWidth}}" height="{{imageHeight}}" style="display:inline-block;max-width:70px;max-height:70px;border:0;" />{{else}}<img src="{{imageUrl}}" alt="{{name}}" style="display:inline-block;max-width:70px;max-height:70px;height:auto;border:0;" />{{/if}}</td></tr></table>`;
}
