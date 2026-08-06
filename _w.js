const { PrismaClient } = require("@prisma/client");
(async () => {
  const p = new PrismaClient();
  for (let i = 0; i < 60; i++) {
    try {
      const r = await p.$queryRawUnsafe(`SELECT to_regclass('public."ArchiveVerification"') AS t`);
      if (r[0]?.t) { console.log("MIGRATION APPLIED"); await p.$disconnect(); process.exit(0); }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 15000));
  }
  console.log("TIMED OUT"); await p.$disconnect(); process.exit(1);
})();
