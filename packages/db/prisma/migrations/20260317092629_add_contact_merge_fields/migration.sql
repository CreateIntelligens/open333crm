-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mergedIntoId" UUID;
