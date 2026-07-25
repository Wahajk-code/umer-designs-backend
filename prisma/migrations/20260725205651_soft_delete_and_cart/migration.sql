-- DropIndex
DROP INDEX "orders_stripe_checkout_session_id_key";

-- DropIndex
DROP INDEX "orders_stripe_payment_intent_id_key";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "orders_stripe_checkout_session_id_idx" ON "orders"("stripe_checkout_session_id");
