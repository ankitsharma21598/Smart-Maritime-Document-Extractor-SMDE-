import { sequelize } from "../db/sequelize.js";
import { defineSessionModel } from "./session.model.js";
import { defineExtractionCacheModel } from "./extractionCache.model.js";
import { defineDocumentModel } from "./document.model.js";
import { defineJobModel } from "./job.model.js";
import { defineSessionValidationModel } from "./sessionValidation.model.js";

const Session = defineSessionModel(sequelize);
const ExtractionCache = defineExtractionCacheModel(sequelize);
const Document = defineDocumentModel(sequelize);
const Job = defineJobModel(sequelize);
const SessionValidation = defineSessionValidationModel(sequelize);

Session.hasMany(Document, { foreignKey: "sessionId", as: "documents" });
Document.belongsTo(Session, { foreignKey: "sessionId", as: "session" });
ExtractionCache.hasMany(Document, { foreignKey: "fileHash", sourceKey: "fileHash", as: "documents" });
Document.belongsTo(ExtractionCache, { foreignKey: "fileHash", targetKey: "fileHash", as: "cache" });

export const models = { Session, ExtractionCache, Document, Job, SessionValidation };
export { sequelize };
