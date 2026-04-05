/**
 * 25 изображений с Unsplash (1080×1080, бесплатные)
 * Категории: Природа, Фэнтези, Города, Абстракция
 */
const PUZZLE_IMAGES = [
  // ── Природа ──
  { id: 1,  title: 'Альпы',        emoji: '🏔️', url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1080&h=1080&fit=crop&auto=format' },
  { id: 2,  title: 'Лес',          emoji: '🌲', url: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1080&h=1080&fit=crop&auto=format' },
  { id: 3,  title: 'Горное озеро', emoji: '🏞️', url: 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=1080&h=1080&fit=crop&auto=format' },
  { id: 4,  title: 'Пустыня',      emoji: '🏜️', url: 'https://images.unsplash.com/photo-1509316785289-f3b3f0c279e3?w=1080&h=1080&fit=crop&auto=format' },
  { id: 5,  title: 'Водопад',      emoji: '💧', url: 'https://images.unsplash.com/photo-1520962880247-cfaf541c8724?w=1080&h=1080&fit=crop&auto=format' },
  { id: 6,  title: 'Океан',        emoji: '🌊', url: 'https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=1080&h=1080&fit=crop&auto=format' },
  { id: 7,  title: 'Закат',        emoji: '🌅', url: 'https://images.unsplash.com/photo-1495616811223-4d98c6e9c869?w=1080&h=1080&fit=crop&auto=format' },
  { id: 8,  title: 'Джунгли',      emoji: '🌿', url: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=1080&h=1080&fit=crop&auto=format' },
  // ── Фэнтези ──
  { id: 9,  title: 'Сияние',       emoji: '✨', url: 'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=1080&h=1080&fit=crop&auto=format' },
  { id: 10, title: 'Замок',        emoji: '🏰', url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1080&h=1080&fit=crop&auto=format' },
  { id: 11, title: 'Сакура',       emoji: '🌸', url: 'https://images.unsplash.com/photo-1545569341-9eb8b30979d9?w=1080&h=1080&fit=crop&auto=format' },
  { id: 12, title: 'Галактика',    emoji: '🌌', url: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=1080&h=1080&fit=crop&auto=format' },
  { id: 13, title: 'Аврора',       emoji: '🔮', url: 'https://images.unsplash.com/photo-1483347756197-71ef80e95f73?w=1080&h=1080&fit=crop&auto=format' },
  // ── Города ──
  { id: 14, title: 'Нью-Йорк',     emoji: '🗽', url: 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=1080&h=1080&fit=crop&auto=format' },
  { id: 15, title: 'Токио',        emoji: '🏯', url: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=1080&h=1080&fit=crop&auto=format' },
  { id: 16, title: 'Дубай',        emoji: '🏙️', url: 'https://images.unsplash.com/photo-1518684079-3c830dcef090?w=1080&h=1080&fit=crop&auto=format' },
  { id: 17, title: 'Ночной город', emoji: '🌃', url: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=1080&h=1080&fit=crop&auto=format' },
  { id: 18, title: 'Париж',        emoji: '🗼', url: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=1080&h=1080&fit=crop&auto=format' },
  { id: 19, title: 'Огни',         emoji: '💡', url: 'https://images.unsplash.com/photo-1480714378702-2f0bc5de5b62?w=1080&h=1080&fit=crop&auto=format' },
  // ── Абстракция ──
  { id: 20, title: 'Неон',         emoji: '🌈', url: 'https://images.unsplash.com/photo-1558470598-a5dda9640f68?w=1080&h=1080&fit=crop&auto=format' },
  { id: 21, title: 'Градиент',     emoji: '🎨', url: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=1080&h=1080&fit=crop&auto=format' },
  { id: 22, title: 'Фиолетовый',   emoji: '🔷', url: 'https://images.unsplash.com/photo-1557682224-5b8590cd9ec5?w=1080&h=1080&fit=crop&auto=format' },
  { id: 23, title: 'Геометрия',    emoji: '⬡',  url: 'https://images.unsplash.com/photo-1558591710-4b4a1ae0f04d?w=1080&h=1080&fit=crop&auto=format' },
  { id: 24, title: 'Краски',       emoji: '🎭', url: 'https://images.unsplash.com/photo-1604076913837-52ab5629fba9?w=1080&h=1080&fit=crop&auto=format' },
  { id: 25, title: 'Свет',         emoji: '✦',  url: 'https://images.unsplash.com/photo-1500462918059-b1a4f0bc7f36?w=1080&h=1080&fit=crop&auto=format' },
];

/** Случайное изображение, никогда не повторяет lastId */
export function getRandomPuzzleImage(lastId) {
  const pool = PUZZLE_IMAGES.filter((img) => img.id !== lastId);
  return pool[Math.floor(Math.random() * pool.length)];
}

export default PUZZLE_IMAGES;
