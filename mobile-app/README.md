# Wongpai Mobile App

โปรเจคนี้ใช้ `Capacitor` เพื่อแพ็กเว็บเกม `วงไพ่สายดื่ม` ให้กลายเป็น native mobile app แยกจากเว็บหลัก โดยเว็บหลักอยู่ในโฟลเดอร์พี่น้อง `../web-app`

## โครงสร้าง

- `www/` คือไฟล์เว็บที่ถูก copy มาจาก `../web-app`
- `scripts/sync-web-assets.mjs` ใช้ sync `index.html`, `app.js`, `cards.js`, `styles.css`, และ `assets/` จาก `../web-app`

## คำสั่งหลัก

```bash
cd mobile-app
npm install
npm run sync:web
```

หลังจากนั้นเพิ่มแพลตฟอร์ม:

```bash
npm run android:add
npm run ios:add
```

ถ้าแก้เว็บหลักภายหลัง ให้ sync กลับเข้ามือถือ:

```bash
npm run cap:sync
```

## เปิดโปรเจค native

Android:

```bash
npm run android:open
```

iOS:

```bash
npm run ios:open
```

## ข้อจำกัดจริง

- Android build ได้บน Windows ผ่าน Android Studio
- iOS build และลงเครื่องจริง/ส่ง App Store ต้องใช้ macOS + Xcode
- ถ้าจะปล่อยขึ้น App Store / Play Store มีค่าใช้จ่ายฝั่ง store account แต่ตัว stack ที่ใช้ทำแอปนี้ฟรี
