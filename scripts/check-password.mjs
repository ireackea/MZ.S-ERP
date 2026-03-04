import bcrypt from 'bcryptjs';

const hash = "$2a$10$zwiRW6XZc7PEyLV3x05kEugygpewubWNnDFv8HrykRGdKW1TMjRdO";
const password = "SecurePassword2026!";

bcrypt.compare(password, hash, (err, res) => {
  if (err) {
    console.error('خطأ في التحقق:', err);
    process.exit(1);
  }
  if (res) {
    console.log('كلمة المرور الافتراضية صحيحة ✅');
  } else {
    console.log('كلمة المرور الافتراضية غير صحيحة ❌');
  }
});
