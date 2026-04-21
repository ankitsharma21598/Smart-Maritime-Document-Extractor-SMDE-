import { DataTypes, type Sequelize } from "sequelize";

export function defineSessionValidationModel(sequelize: Sequelize) {
  return sequelize.define(
    "SessionValidation",
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      sessionId: { type: DataTypes.UUID, allowNull: false, field: "session_id" },
      result: { type: DataTypes.JSONB, allowNull: true },
      errorMessage: { type: DataTypes.TEXT, allowNull: true, field: "error_message" },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "created_at" },
    },
    { tableName: "session_validations", timestamps: false }
  );
}
