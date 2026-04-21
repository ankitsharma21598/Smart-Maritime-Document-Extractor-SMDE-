import { DataTypes, type Sequelize } from "sequelize";

export function defineExtractionCacheModel(sequelize: Sequelize) {
  return sequelize.define(
    "ExtractionCache",
    {
      fileHash: { type: DataTypes.STRING(64), primaryKey: true, field: "file_hash" },
      status: { type: DataTypes.STRING, allowNull: false },
      documentType: { type: DataTypes.STRING, allowNull: true, field: "document_type" },
      documentName: { type: DataTypes.TEXT, allowNull: true, field: "document_name" },
      applicableRole: { type: DataTypes.STRING(16), allowNull: true, field: "applicable_role" },
      confidence: { type: DataTypes.STRING(16), allowNull: true },
      holderName: { type: DataTypes.TEXT, allowNull: true, field: "holder_name" },
      dateOfBirth: { type: DataTypes.STRING(32), allowNull: true, field: "date_of_birth" },
      sirbNumber: { type: DataTypes.STRING(64), allowNull: true, field: "sirb_number" },
      passportNumber: { type: DataTypes.STRING(64), allowNull: true, field: "passport_number" },
      isExpired: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "is_expired" },
      summary: { type: DataTypes.TEXT, allowNull: true },
      processingTimeMs: { type: DataTypes.INTEGER, allowNull: true, field: "processing_time_ms" },
      extraction: { type: DataTypes.JSONB, allowNull: true },
      complianceIssues: { type: DataTypes.JSONB, allowNull: true, field: "compliance_issues" },
      rawLlmResponse: { type: DataTypes.TEXT, allowNull: true, field: "raw_llm_response" },
      errorCode: { type: DataTypes.STRING(64), allowNull: true, field: "error_code" },
      errorMessage: { type: DataTypes.TEXT, allowNull: true, field: "error_message" },
      updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "updated_at" },
    },
    { tableName: "extraction_cache", timestamps: false }
  );
}
