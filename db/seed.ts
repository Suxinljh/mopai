import { getDb } from "../api/queries/connection";

async function seed() {
  const db = getDb();
  console.log("Seeding database...");

  // TODO: insert seed data, e.g.
  // await db.insert(schema.files).values([
  //   { key: "example-key", ownerId: 1, name: "example.png", size: 1024 },
  // ]);

  console.log("Done.");
  process.exit(0);
}

seed();
