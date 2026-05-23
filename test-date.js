const today = new Date();
const day = today.getDay(); // 0 domingo, 1 lunes
const diff = day === 0 ? -6 : 1 - day;
const monday = new Date(today);
monday.setDate(today.getDate() + diff);
monday.setHours(0, 0, 0, 0);
console.log('Today:', today);
console.log('Monday:', monday);
console.log('Monday string:', monday.toISOString());
