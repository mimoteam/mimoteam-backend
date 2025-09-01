// scripts/sync-indexes.ts
import 'dotenv/config';
import mongoose from 'mongoose';
import UserModel from '../src/users/user.model';
import { Service } from '../src/services/service.model';
import Payment from '../src/payments/payment.model';
import Cost from '../src/costs/cost.model';

async function main() {
  await mongoose.connect(process.env.MONGO_URI!);
  console.log('[IDX] sync User');
  await UserModel.syncIndexes();
  console.log('[IDX] sync Service');
  await Service.syncIndexes();
  console.log('[IDX] sync Payment');
  await Payment.syncIndexes();
  console.log('[IDX] sync Cost');
  await Cost.syncIndexes();
  await mongoose.disconnect();
  console.log('[IDX] done');
}
main().catch(e => { console.error(e); process.exit(1); });
