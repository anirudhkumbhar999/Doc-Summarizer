import path from "node:path";
import dotenv from "dotenv";
import { resetCollection } from "../src/services/vectorStore.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: false });
dotenv.config({ path: path.resolve(process.cwd(), "..", ".env"), override: false });
dotenv.config({
  path: path.resolve(process.cwd(), "..", ".env.example"),
  override: false,
});

try {
  await resetCollection();
  console.log("Chroma collection reset complete.");
} catch (error) {
  console.error("Failed to reset Chroma collection:", error.message);
  process.exit(1);
}
