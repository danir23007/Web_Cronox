# Image-loading measurement, 2026-09-24

Read-only reproduction: `node tests/image-loading/measure.cjs gallery desktop after` (replace `gallery` with `store`, and `desktop` with `mobile`). The script serves local frontend files, snapshots only the public `/api/gallery` and `/api/products` responses, and requests public images. `after` enriches the gallery fixture with the already-public product variant records to model the changed backend response. It makes no checkout, admin, or database requests. Browser: Chromium emulation, 1366x768 or 390x844 with DPR 2 on mobile; 150 ms RTT and 200,000 bytes/s download throughput. Cold = fresh context; warm = reload in that context. Browser screenshots and detailed JSON traces go to ignored `test-results/image-*.{png,json}`. `encodedDataLength` counts completed requests only, so an unfinished original is **not** a zero-byte image.

The first gallery lightbox associated-product cards requested these original files before the change:

| Requested URL | Transfer size (HEAD) | Intrinsic | Rendered | Cache-Control |
| --- | ---: | ---: | ---: | --- |
| https://frqlgocxnyppzdgxxjuq.supabase.co/storage/v1/object/public/product-images/products/2026/09/1789603530264-2d9855eb-01dd-4707-af26-39d37abd0db0.png | 10,542,818 B | 3414×4552 | 209×209 desktop / 278×278 mobile | `no-cache` |
| https://frqlgocxnyppzdgxxjuq.supabase.co/storage/v1/object/public/product-images/products/2026/09/1789603575666-df6e7837-eb62-454e-8d7c-9473914484fa.png | 6,806,267 B | 3916×5221 | 209×209 desktop; second card below mobile viewport | `no-cache` |

After the change, those cards request the existing 600×800 WebP `small` variants, respectively:

| Requested URL | Cold encoded transfer | Rendered |
| --- | ---: | ---: |
| https://frqlgocxnyppzdgxxjuq.supabase.co/storage/v1/object/public/product-images/products/variants/0d83c2ecec72e8ca214ff4e46488dc495ace31117bfcb8292b00b8563b97ed6d/small.webp | ~31,158 B | 209×209 desktop / 278×278 mobile |
| https://frqlgocxnyppzdgxxjuq.supabase.co/storage/v1/object/public/product-images/products/variants/8105cfc4feeb61b746f2ac0d19761371601b3b4245653ff331d200f5b8223e57/small.webp | ~8,670 B | 209×209 desktop |

Together this is approximately 17.35 MB of original files versus 39.8 KB of existing variants, a 99.77% payload reduction for these two cards. Before: zero of two desktop visible cards (zero of one mobile visible card) finished after the ten-second observation window, including on warm reload. After: both desktop cards finished within ~0.5–1.3 seconds; the one visible mobile card finished in ~1.0 second. On warm reload the variants came from browser cache (0 transferred image bytes; ~11–22 ms after opening the lightbox). A production cache metadata change was not made; the existing versioned variant URLs were reused.

For ordinary store product cards, the pre-change desktop cold view issued 23 product-image requests for seven cards; only two of seven visible images finished within ten seconds. After, it issued seven product-image requests and all seven finished within ten seconds (latest run ~1.4–7.8 seconds, about 800 KB total). On mobile the browser already requested seven primary images both before and after; four visible primary images finished within ten seconds. The secondary card file is now requested only upon hover or arrow selection and is made eager at that point. The gallery carousel's initial unique grid-image requests dropped from four to three at 390 px; at 1366 px five remained in or near the viewport. Lightbox large variants remain separate from card files.

The storefront's desktop layout-shift score of ~0.48 was unchanged; PerformanceObserver attributed its shift to `.page-home.is-loading`, `.preloader-inner`, and `.hero-video`, not a product-card image. Product-card and related-card CSS reserve their image boxes. The mobile page showed variable page-wide shifts, so this work does not claim a CLS improvement. No physical device was tested; network and device measurements used browser emulation. Functional gallery browser tests also run on Firefox and WebKit, but CDP byte/timing measurements were Chromium-only.
