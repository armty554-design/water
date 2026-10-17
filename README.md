# AquaRoute - ระบบจัดสายส่งน้ำดื่มสำหรับสมาชิก

เว็บแอพพลิเคชันสำหรับบริหารจัดการและจัดเรียงลำดับการส่งน้ำดื่มให้แก่สมาชิก รองรับการนำเข้าไฟล์ข้อมูลสมาชิกจาก Excel (`รายงานข้อมูลสมาชิก.xlsx`), แสดงแผนที่เส้นทางพร้อมปักหมุด GPS, จัดคิวออโต้ตามเวลาจริงและระยะทาง, แยกหน้าต่างการใช้งานอย่างชัดเจนระหว่าง **ฝั่งออฟฟิศ/แอดมิน** และ **ฝั่งคนขับรถ**, พร้อมระบบอัปเดตข้อมูลสมาชิกและแนบรูปภาพ/เอกสาร

---

## ✨ ฟังก์ชันเด่นของระบบ

### 1. 🏢 ฝั่งออฟฟิศ / หัวหน้าโล (Office & Dispatcher)
- **นำเข้าข้อมูล Excel**: อัปโหลดไฟล์ `รายงานข้อมูลสมาชิก.xlsx` ประมวลผลรวดเร็วทันทีผ่านระบบ Client-side IndexedDB
- **กรองตามเบอร์รถและวันส่ง**: เลือกดูตาม *เบอร์รถ* (เช่น รถ 13106, 13205) และ *รอบวัน* (จันทร์–เสาร์)
- **⚡ ระบบจัดคิวออโต้ (Auto-Sequence)** 3 รูปแบบ:
  1. 🕒 **ตามเวลาส่งจริงในอดีต (Historical Actual Time)**: คำนวณเวลาเฉลี่ยจากประวัติ 4 รอบล่าสุด
  2. ⏰ **ตามช่วงเวลานัดหมาย (Time Window Priority)**: เรียงตามช่วงเวลาที่นัดไว้ (เช่น 06:00, 08:30, 11:00)
  3. 📍 **ตามเส้นทาง GPS ที่ใกล้ที่สุด (GPS Nearest Route)**: คำนวณระยะทางไม่ให้ขับรถย้อนไปย้อนมา
- **จัดลำดับเอง (Manual Adjustment)**: เลื่อนขึ้น-ลงเพื่อปรับแต่งคิวส่งหน้างานได้อิสระ
- **Interactive Route Map**: แผนที่ปักหมุดเลขลำดับจุดส่ง (1, 2, 3...) พร้อมลากเส้นเชื่อมสายส่ง
- **ระบบสมาชิกและแนบไฟล์**: แก้ไขข้อมูลสมาชิก พิกัด GPS และแนบรูปภาพหน้าบ้าน/จุดวางถังน้ำ/เอกสาร

### 2. 🚚 ฝั่งคนขับรถ (Driver Mode - ใช้งานง่ายบนมือถือ)
- **หน้าจอเรียบง่าย ชัดเจน**: ดูเฉพาะแผนที่และรายการจุดส่งของรถตนเอง
- **ปุ่มนำทาง 1 คลิก (Google Maps)**: กดปุ่ม "📍 เปิด Google Maps นำทาง" เพื่อเปิดระบบ GPS นำทางตรงถึงบ้านลูกค้า
- **การ์ดจุดส่งถัดไป (Next Stop Hero Card)**: แสดงชื่อลูกค้า, ช่วงเวลาส่ง, จำนวนถังน้ำ, และเงื่อนไขการรับน้ำ
- **ปุ่มกด "✅ ส่งเสร็จสิ้น"**: เมื่อส่งน้ำแล้ว กดปุ่มเดียวเพื่ออัปเดตสถานะทันที (แสดงเอฟเฟกต์ฉลองความสำเร็จ และเปลี่ยนเป็นจุดถัดไปให้อัตโนมัติ)
- แถบสรุปความคืบหน้าการส่งแบบ Real-time (เช่น *ส่งแล้ว 15 / 35 จุด*)

---

## 🚀 วิธีการรันโปรเจกต์บนเครื่อง (Local Development)

```bash
# ติดตั้ง dependencies
npm install

# รัน Development Server
npm run dev
```

เปิดบราวเซอร์ไปที่: `http://localhost:3000`

---

## 🌐 การเชื่อมต่อ GitHub และขึ้นระบบ Vercel (vercel.app)

### 1. เชื่อมต่อ Git & GitHub
สร้าง Repository ใหม่บน [GitHub.com](https://github.com) แล้วรันคำสั่ง:

```bash
git add .
git commit -m "feat: initial water delivery dispatch web app"
git branch -M main
git remote add origin https://github.com/<YOUR_USERNAME>/<YOUR_REPO_NAME>.git
git push -u origin main
```

### 2. เผยแพร่ขึ้น Vercel (vercel.app)
1. ไปที่ [Vercel Dashboard](https://vercel.com)
2. คลิกปุ่ม **"Add New Project"** -> เลือก Repository ที่เพิ่ง Push ขึ้น GitHub
3. ในส่วน **Framework Preset** เลือกเป็น `Vite` (Vercel จะตรวจจับอัตโนมัติ)
4. กดปุ่ม **"Deploy"**
5. รอประมาณ 30 วินาที จะได้ URL เช่น `https://aqua-route-delivery.vercel.app` พร้อมใช้งานได้ทันทีบนมือถือและคอมพิวเตอร์!

---

## 🛠️ เทคโนโลยีที่ใช้
- **Frontend Framework**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS + Lucide Icons + Google Fonts (Inter & Sarabun)
- **Map Engine**: Leaflet + OpenStreetMap + Google Maps Navigation Deep Links
- **Data & Storage**: 
  - SheetJS (`xlsx`) วิเคราะห์ข้อมูลสมาชิก 21,000+ รายการได้รวดเร็ว
  - IndexedDB (`idb-keyval`) ทำงานแบบ Local-first ออฟไลน์ได้
  - **Firebase Cloud Firestore** ซิงค์ข้อมูล Real-time ระหว่างคอมพิวเตอร์ Office และมือถือของคนขับรถ

---

## 👨‍💻 ผู้พัฒนาและลิขสิทธิ์ (Author & Credits)
- **พัฒนาและออกแบบโดย**: [armty554-design](https://github.com/armty554-design)
- **GitHub Repository**: [https://github.com/armty554-design/water](https://github.com/armty554-design/water)
- **ระบบ**: AquaRoute - Water Delivery Route Dispatch & Real-Time Tracking
