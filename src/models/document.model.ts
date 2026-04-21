import { DataTypes, type Sequelize } from "sequelize";

export function defineDocumentModel(sequelize: Sequelize) {
  return sequelize.define(
    "Document",
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      sessionId: { type: DataTypes.UUID, allowNull: false, field: "session_id", references: { model: "sessions", key: "id" }, onDelete: "CASCADE" },
      fileHash: { type: DataTypes.STRING(64), allowNull: false, field: "file_hash", references: { model: "extraction_cache", key: "file_hash" } },
      originalFilename: { type: DataTypes.TEXT, allowNull: false, field: "original_filename" },
      mimeType: { type: DataTypes.TEXT, allowNull: false, field: "mime_type" },
      byteSize: { type: DataTypes.INTEGER, allowNull: false, field: "byte_size" },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "created_at" },
    },
    { tableName: "documents", timestamps: false }
  );
}
