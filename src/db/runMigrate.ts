import { migrate } from "./migrate.js";
import { sequelize } from "../models/index.js";

await migrate();
await sequelize.close();
console.log("Migration applied.");
