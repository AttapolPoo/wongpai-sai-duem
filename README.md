# วงไพ่สายดื่ม

เกมไพ่ปาร์ตี้ online เล่นได้หลายคนพร้อมกัน — host สุ่มไพ่, เพื่อนเห็นพร้อมกัน real-time

## วิธี Deploy บน Netlify

### 1. สมัคร Ably (ฟรี ไม่ต้องบัตร)

1. ไปที่ [ably.com](https://ably.com) → Sign up ฟรี
2. เข้า Dashboard → สร้าง App ใหม่
3. ไปที่ **API Keys** → คัดลอก Root API Key (รูปแบบ `xxxxx.yyyyy:zzzzz`)

### 2. ใส่ API Key ในโค้ด

เปิดไฟล์ `app.js` บรรทัดที่ 4:

```js
const ABLY_KEY = "YOUR_ABLY_API_KEY";
```

แทน `YOUR_ABLY_API_KEY` ด้วย key ที่ได้จาก Ably

### 3. Push ขึ้น GitHub

```bash
git add app.js
git commit -m "Add Ably API key"
git push
```

### 4. Deploy บน Netlify

1. ไปที่ [netlify.com](https://netlify.com) → Login ด้วย GitHub
2. **Add new site** → **Import an existing project** → เลือก repo `wongpai-sai-duem`
3. ตั้งค่า: Build command ว่าง, Publish directory `.`
4. กด **Deploy** — ได้ URL สาธารณะทันที

## เล่นในเครื่องเอง

```bash
npm run dev
```

เปิด [http://localhost:4173](http://localhost:4173)

## วิธีเล่น

- **สร้างห้อง** — ใส่ชื่อเล่น กด "เปิด Host Public" หรือ "เปิดห้องส่วนตัว"
- **เข้าห้อง** — ใส่รหัสห้อง 6 ตัวอักษร หรือกดลิงก์ที่ Host แชร์
- **สุ่มไพ่** — เฉพาะ Host กดสุ่มได้ ทุกคนในห้องเห็นพร้อมกัน real-time
- **ไพ่ 100 ใบ** ไม่ซ้ำจนหมดเด็ค
