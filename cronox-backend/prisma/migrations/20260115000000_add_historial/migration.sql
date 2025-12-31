-- CreateTable
CREATE TABLE "historial" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "pedidosRealizados" INTEGER NOT NULL DEFAULT 0,
    "articulosAdquiridos" INTEGER NOT NULL DEFAULT 0,
    "devoluciones" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "historial_userId_key" ON "historial"("userId");

-- AddForeignKey
ALTER TABLE "historial" ADD CONSTRAINT "historial_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
