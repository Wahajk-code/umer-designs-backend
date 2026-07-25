-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "credit_applied_cents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "credit_balance_cents" INTEGER NOT NULL DEFAULT 0;
