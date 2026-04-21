import { DataTypes, type Sequelize } from "sequelize";

export function defineJobModel(sequelize: Sequelize) {
  return sequelize.define(
    "Job",
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      kind: { type: DataTypes.STRING, allowNull: false },
      fileHash: { type: DataTypes.STRING(64), allowNull: true, field: "file_hash" },
      documentId: { type: DataTypes.UUID, allowNull: true, field: "document_id" },
      sessionId: { type: DataTypes.UUID, allowNull: true, field: "session_id" },
      status: { type: DataTypes.STRING, allowNull: false },
      errorCode: { type: DataTypes.STRING(64), allowNull: true, field: "error_code" },
      errorMessage: { type: DataTypes.TEXT, allowNull: true, field: "error_message" },
      result: { type: DataTypes.JSONB, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "created_at" },
      startedAt: { type: DataTypes.DATE, allowNull: true, field: "started_at" },
      completedAt: { type: DataTypes.DATE, allowNull: true, field: "completed_at" },
    },
    { tableName: "jobs", timestamps: false }
  );
}
