const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { request } = require("@playwright/test");
const {
  loadLocalEnvironment,
} = require("../../cronox-backend/scripts/start-local.cjs");
const {
  PrismaClient,
} = require("../../cronox-backend/node_modules/@prisma/client");
const bcrypt = require("../../cronox-backend/node_modules/bcrypt");
async function run(withBrowser) {
  const env = loadLocalEnvironment(),
    url = new URL(env.DATABASE_URL);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "5433");
  assert.equal(url.pathname, "/cronox_dev");
  assert.equal(env.EMAIL_ENABLED, "false");
  const db = new PrismaClient({
      datasources: { db: { url: env.DATABASE_URL } },
    }),
    tag = "bulk-qa-" + randomUUID(),
    password = randomUUID(),
    contexts = [];
  const users = [],
    products = [],
    categories = [];
  const ctx = async () => {
    const c = await request.newContext({ baseURL: "http://localhost:3000" });
    contexts.push(c);
    return c;
  };
  const post = async (c, path, data) => {
    await c.get("/api/auth/csrf");
    const cookies = (await c.storageState()).cookies;
    return c.post(path, {
      data,
      headers: {
        Origin: "http://localhost:3000",
        "x-csrf-token": decodeURIComponent(
          cookies.find((c) => c.name === "cronox_csrf_token").value,
        ),
      },
    });
  };
  try {
    const hash = await bcrypt.hash(password, 10);
    for (const role of ["SUPERADMIN", "SUPERADMIN", "ADMIN", "USER", "USER"])
      users.push(
        await db.user.create({
          data: {
            name: tag + " " + role,
            email: `${tag}-${users.length}@example.test`,
            password: hash,
            role,
            accountState: "ACTIVE",
          },
        }),
      );
    for (let i = 0; i < 3; i++)
      categories.push(
        await db.category.create({
          data: { name: tag + " cat " + i, slug: tag + "-" + i },
        }),
      );
    for (let i = 0; i < 3; i++)
      products.push(
        await db.product.create({
          data: {
            name: tag + " product " + i,
            slug: tag + "-" + i,
            price: 1234,
            isActive: i !== 1,
            categories: { create: { categoryId: categories[0].id } },
          },
        }),
      );
    const admin = await ctx(),
      normal = await ctx(),
      guest = await ctx(),
      member = await ctx();
    for (const [c, u] of [
      [admin, users[0]],
      [normal, users[2]],
      [member, users[3]],
    ])
      assert.equal(
        (
          await post(c, "/api/auth/login", { email: u.email, password })
        ).status(),
        200,
      );
    const base = "/api/admin/bulk/",
      preview = async (payload) => {
        const r = await post(admin, base + "preview", payload);
        assert.equal(r.status(), 201, await r.text());
        return r.json();
      };
    const execute = (payload, plan, id = randomUUID()) =>
      post(admin, base + "execute", {
        ...payload,
        reviewToken: plan.reviewToken,
        operationId: id,
      });
    const pids = products.map((p) => p.id),
      payload = { kind: "products", ids: pids, changes: { isActive: false } };
    assert.equal((await guest.get(base + "products/selection")).status(), 401);
    assert.equal((await post(normal, base + "preview", payload)).status(), 403);
    assert.equal((await post(member, base + "preview", payload)).status(), 403);
    const selected = await (
      await admin.get(base + "products/selection?q=" + tag)
    ).json();
    assert.deepEqual(selected.ids, pids);
    let plan = await preview(payload);
    assert.deepEqual(plan.counts, { changed: 2, unchanged: 1, excluded: 0 });
    const op = randomUUID(),
      results = await Promise.all([
        execute(payload, plan, op),
        execute(payload, plan, op),
      ]);
    for (const r of results) assert.equal(r.status(), 201, await r.text());
    assert.deepEqual(await results[0].json(), await results[1].json());
    assert.equal(
      await db.auditLog.count({
        where: { targetId: op, actionType: "admin.bulk.update" },
      }),
      1,
    );
    assert.equal((await admin.get(base + "operations/" + op)).status(), 200);
    assert.equal(
      (
        await execute({ ...payload, changes: { isActive: true } }, plan, op)
      ).status(),
      409,
    );
    let state = await db.product.findMany({ where: { id: { in: pids } } });
    assert(state.every((p) => !p.isActive));
    const assignments = async (id) =>
      (
        await db.productCategory.findMany({
          where: { productId: id },
          orderBy: { categoryId: "asc" },
        })
      ).map((c) => c.categoryId);
    for (const [mode, ids, expected] of [
      [
        "add",
        [categories[1].id, categories[1].id],
        [categories[0].id, categories[1].id],
      ],
      ["remove", [categories[0].id], [categories[1].id]],
      ["replace", [categories[2].id], [categories[2].id]],
      ["clear", undefined, []],
    ]) {
      const x = {
        kind: "products",
        ids: pids,
        changes: { categoryMode: mode, ...(ids ? { categoryIds: ids } : {}) },
      };
      assert.equal((await execute(x, await preview(x))).status(), 201);
      for (const id of pids) assert.deepEqual(await assignments(id), expected);
    }
    const publicChange = {
      kind: "products",
      ids: [pids[0]],
      changes: {
        isActive: true,
        categoryMode: "add",
        categoryIds: [categories[0].id],
      },
    };
    assert.equal(
      (await execute(publicChange, await preview(publicChange))).status(),
      201,
    );
    let publicList = await (
      await guest.get("/api/categories/" + categories[0].slug + "/products")
    ).json();
    assert(publicList.products.items.some((p) => p.id === pids[0]));
    publicChange.changes = { isActive: false };
    assert.equal(
      (await execute(publicChange, await preview(publicChange))).status(),
      201,
    );
    publicList = await (
      await guest.get("/api/categories/" + categories[0].slug + "/products")
    ).json();
    assert.equal(publicList.products.items.length, 0);
    assert.equal(
      (
        await post(admin, base + "preview", {
          ...payload,
          changes: { categoryMode: "replace", categoryIds: [] },
        })
      ).status(),
      400,
    );
    assert.equal(
      (
        await post(admin, base + "preview", {
          ...payload,
          changes: {
            isActive: true,
            categoryMode: "add",
            categoryIds: [2147483647],
          },
        })
      ).status(),
      400,
    );
    assert(
      (await db.product.findMany({ where: { id: { in: pids } } })).every(
        (p) => !p.isActive,
      ),
    );
    for (const changes of [
      { price: 5 },
      { isActive: null },
      { role: "SUPERADMIN" },
      { categoryMode: "clear", categoryIds: [categories[0].id] },
    ])
      assert.equal(
        (await post(admin, base + "preview", { ...payload, changes })).status(),
        400,
      );
    const next = { ...payload, changes: { isActive: true } };
    plan = await preview(next);
    await db.product.update({
      where: { id: pids[0] },
      data: { name: tag + " changed" },
    });
    assert.equal((await execute(next, plan)).status(), 409);
    assert.equal(
      await db.product.count({ where: { id: { in: pids }, isActive: true } }),
      0,
    );
    plan = await preview(next);
    await db.product.delete({ where: { id: pids[2] } });
    assert.equal((await execute(next, plan)).status(), 409);
    const up = {
      kind: "users",
      ids: users.map((u) => u.id),
      changes: { role: "FRIEND", circleLevel: 3 },
    };
    plan = await preview(up);
    assert.equal(plan.counts.excluded, 2);
    assert.equal(plan.counts.changed, 3);
    assert.equal((await execute(up, plan)).status(), 201);
    for (const u of users.slice(2)) {
      const record = await db.user.findUnique({ where: { id: u.id } });
      assert.equal(record.role, "FRIEND");
      assert.equal(record.circleLevel, 3);
      assert.equal(record.sessionVersion, 1);
    }
    assert.equal(
      (await member.get("/api/me")).status(),
      401,
      "old user session invalidated after role change",
    );
    const permissions = {
      kind: "products",
      ids: [pids[0]],
      changes: { isActive: true },
    };
    plan = await preview(permissions);
    await db.user.update({
      where: { id: users[0].id },
      data: { role: "ADMIN" },
    });
    assert.equal((await execute(permissions, plan)).status(), 403);
    await db.user.update({
      where: { id: users[0].id },
      data: { role: "SUPERADMIN" },
    });
    const originalIds = [
      ...(await (await admin.get(base + "products/selection?q=" + tag)).json())
        .ids,
    ];
    const extra = await db.product.create({
      data: { name: tag + " later", slug: tag + "later", price: 100 },
    });
    products.push(extra);
    assert(!originalIds.includes(extra.id));
    await db.product.createMany({
      data: Array.from({ length: 101 }, (_, i) => ({
        name: tag + " limit",
        slug: tag + "limit" + i,
        price: 100,
      })),
    });
    assert.equal(
      (await admin.get(base + "products/selection?q=" + tag)).status(),
      400,
    );
    assert.equal(
      (
        await post(admin, base + "preview", {
          ...payload,
          ids: Array(101).fill(pids[0]),
        })
      ).status(),
      400,
    );
    await db.product.deleteMany({
      where: { slug: { startsWith: tag + "limit" } },
    });
    if (withBrowser)
      await withBrowser({
        db,
        tag,
        password,
        actor: users[0],
        products: products.filter((p) => p.id !== pids[2]),
        categories,
      });
    console.log(
      "PASS bulk: permissions, exclusions, session invalidation, filtered snapshot/limit, add/remove/replace/clear, unchanged, concurrent mutation/deletion, invalid input rollback, simultaneous retries and durable result.",
    );
  } finally {
    const actorIds = users.map((u) => u.id);
    await db.auditLog.deleteMany({ where: { actorId: { in: actorIds } } });
    await db.adminBulkOperation.deleteMany({
      where: { actorId: { in: actorIds } },
    });
    await db.product.deleteMany({ where: { slug: { startsWith: tag } } });
    await db.category.deleteMany({
      where: { id: { in: categories.map((c) => c.id) } },
    });
    await db.user.deleteMany({ where: { id: { in: actorIds } } });
    await Promise.all(contexts.map((c) => c.dispose()));
    await db.$disconnect();
  }
}
module.exports = { run };
if (require.main === module)
  run().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
