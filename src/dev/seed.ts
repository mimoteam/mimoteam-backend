// backend/src/dev/seed.ts
import bcrypt from "bcryptjs";
import User from "../users/user.model";

export async function seedIfEmpty() {
  const count = await User.countDocuments({});
  if (count > 0) {
    console.log(`[SEED] Users already exist: ${count}`);
    return;
  }

  const adminPass = process.env.ADMIN_PASSWORD || "admin123";
  const hash = await bcrypt.hash(adminPass, 10);

  await User.create({
    fullName: "Admin",
    email: "admin@example.com",
    login: "admin",
    password: hash,
    role: "admin",
    status: "active",
  });

  console.log(`[SEED] Created admin -> login=admin / password=${adminPass}`);
}

export default seedIfEmpty;
