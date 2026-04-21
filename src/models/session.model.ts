import { DataTypes, type Sequelize } from "sequelize";

export function defineSessionModel(sequelize: Sequelize) {
  return sequelize.define(
    "Session",
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "created_at" },
    },
    { tableName: "sessions", timestamps: false }
  );
}
