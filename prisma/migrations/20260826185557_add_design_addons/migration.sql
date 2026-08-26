-- CreateTable
CREATE TABLE "design_add_ons" (
    "id" TEXT NOT NULL,
    "design_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "added_cost_cents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_add_ons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_selected_add_ons" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "add_on_id" TEXT NOT NULL,
    "price_at_selection_cents" INTEGER NOT NULL,

    CONSTRAINT "order_selected_add_ons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_selected_add_ons_order_id_add_on_id_key" ON "order_selected_add_ons"("order_id", "add_on_id");

-- AddForeignKey
ALTER TABLE "design_add_ons" ADD CONSTRAINT "design_add_ons_design_id_fkey" FOREIGN KEY ("design_id") REFERENCES "designs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_selected_add_ons" ADD CONSTRAINT "order_selected_add_ons_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_selected_add_ons" ADD CONSTRAINT "order_selected_add_ons_add_on_id_fkey" FOREIGN KEY ("add_on_id") REFERENCES "design_add_ons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
