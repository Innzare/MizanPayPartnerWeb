-- "Partner removed a payment row" activity. Triggered by DELETE /payments/:id
-- when partner drops an unpaid row (mistakenly added, or imported ghost).
ALTER TYPE "ActivityType" ADD VALUE 'PAYMENT_REMOVED';
