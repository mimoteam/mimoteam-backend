// scripts/sync-indexes.ts
import 'dotenv/config';
import mongoose from 'mongoose';

import UserModel from '../src/users/user.model';
import { Service } from '../src/services/service.model';
import Payment from '../src/payments/payment.model';
import Cost from '../src/costs/cost.model';
import Task from '../src/tasks/task.model';
import Handover from '../src/handover/handover.model';

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('[IDX] MONGO_URI missing in env');
    process.exit(1);
  }

  console.log('[IDX] connecting…');
  await mongoose.connect(uri);

  try {
    console.log('[IDX] sync User');
    await UserModel.syncIndexes();

    console.log('[IDX] sync Service');
    await Service.syncIndexes();

    console.log('[IDX] sync Payment');
    await Payment.syncIndexes();

    console.log('[IDX] sync Cost');
    await Cost.syncIndexes();

    console.log('[IDX] sync Task');
    await Task.syncIndexes();

    console.log('[IDX] sync Handover');
    await Handover.syncIndexes();

    console.log('[IDX] done ✅');
  } catch (e) {
    console.error('[IDX] error while syncing indexes:', e);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('[IDX] disconnected');
  }
}

main().catch((e) => {
  console.error('[IDX] fatal error:', e);
  process.exit(1);
});
