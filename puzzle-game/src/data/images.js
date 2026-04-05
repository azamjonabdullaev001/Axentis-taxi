/**
 * 25 curated high-resolution images (1080×1080) from Unsplash.
 * Categories: Природа, Фэнтези, Города, Абстракция
 */

const IMAGES = [
  // ── Природа ────────────────────────────────────────────────────────────────
  {
    id: 1,
    title: 'Альпы',
    category: 'Природа',
    emoji: '🏔️',
    url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1080&h=1080&fit=crop&auto=format',
  },
  {
    id: 2,
    title: 'Лес',
    category: 'Природа',
    emoji: '🌲',
    url: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1080&h=1080&fit=crop&auto=format',
  },
  {
    id: 3,
    title: 'Горное озеро',
    category: 'Природа',
    emoji: '🏞️',
    url: 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=1080&h=1080&fit=crop&auto=format',
  },
  {
    id: 4,
    title: 'Пустыня',
    category: 'Природа',
    emoji: '🏜️',
    url: 'https://images.unsplash.com/photo-1509316785289-f3b3f0c279e3?w=1080&h=1080&fit=crop&auto=format',
  },
  {
    id: 5,
    title: 'Водопад',
    category: 'Природа',
    emoji: '💧',
    url: 'https://images.unsplash.com/photo-1520962880247-cfaf541c8724?w=1080&h=1080&fit=crop&auto=format',
  },
  {
    id: 6,
    title: 'Океан',
    category: 'Природа',
    emoji: '🌊',
    url: 'https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=1080&h=1080&fit=crop&auto=format',
  },
  {
    id: 7,
    title: 'Закат',
    category: 'Природа',
    emoji: '🌅',
    url: 'https://images.unsplash.com/photo-1495616811223-4d98c6e9c869?w=1080&h=1080&fit=crop&auto=format',
  },
  {
    id: 8,
    title: 'Джунгли',
    category: 'Природа',
    emoji: '🌿',
    url: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=1080&h=1080&fit=crop&auto=format',
  },

  // ── Фэнтези ────────────────────────────────────────────────────────────────
  {
    id: 9,
    title: 'Северное сияние',
    category: 'Фэнтези',
    emoji: '✨',
    url: 'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=1080&h=1080&fit=crop&auto=format',
  },
  {
    id: 10,
    title: 'Замок',
    category: 'Фэнтези',
    emoji: '🏰',
    url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1080&h=1080&fit=crop&auto=format',
  },
  {
    id: 11,
    title: 'Сакура',
    category: 'Фэнтези',
    emoji: '🌸',
    url: 'https://images.unsplash.com/photo-1545569341-9eb8b30979d9?w=1080&h=1080&fit=crop&auto=format',
  },
  {
    id: 12,
    title: 'Галактика',
    category: 'Фэнтези',
    emoji: '🌌',
    url: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=1080&h=1080&fit=crop&auto=format',
  },
  {
    id: 13,
    title: 'Аврора',
    category: 'Фэнтези',
    emoji: '🔮',
    url: 'https://images.unsplash.com/photo-1483347756197-71ef80e95f73?w=1080&h=1080&fit=crop&auto=format',
  },

  // ── Города ─────────────────────────────────────────────────────────────────
  {
    id: 14,
    title: 'Нью-Йорк',
    category: 'Города',
    emoji: '🗽',
    url: 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=1080&h=1080&fit=crop&auto=format',
  },
  {
    id: 15,
    title: 'Токио',
    category: 'Города',
    emoji: '🏯',
    url: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=1080&h=1080&fit=crop&auto=format',
  },
  {
    id: 16,
    title: 'Дубай',
    category: 'Города',
    emoji: '🏙️',
    url: 'https://images.unsplash.com/photo-1518684079-3c830dcef090?w=1080&h=1080&fit=crop&auto=format',
  },
  {
    id: 17,
    title: 'Ночной город',
    category: 'Города',
    emoji: '🌃',
    url: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=1080&h=1080&fit=crop&auto=format',
  },
  {
    id: 18,
    title: 'Париж',
    category: 'Города',
    emoji: '🗼',
    url: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=1080&h=1080&fit=crop&auto=format',
  },
  {
    id: 19,
    title: 'Огни города',
    category: 'Города',
    emoji: '💡',
    url: 'https://images.unsplash.com/photo-1480714378702-2f0bc5de5b62?w=1080&h=1080&fit=crop&auto=format',
  },

  // ── Абстракция ─────────────────────────────────────────────────────────────
  {
    id: 20,
    title: 'Неон',
    category: 'Абстракция',
    emoji: '🌈',
    url: 'https://images.unsplash.com/photo-1558470598-a5dda9640f68?w=1080&h=1080&fit=crop&auto=format',
  },
  {
    id: 21,
    title: 'Градиент',
    category: 'Абстракция',
    emoji: '🎨',
    url: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=1080&h=1080&fit=crop&auto=format',
  },
  {
    id: 22,
    title: 'Фиолетовый',
    category: 'Абстракция',
    emoji: '🔷',
    url: 'https://images.unsplash.com/photo-1557682224-5b8590cd9ec5?w=1080&h=1080&fit=crop&auto=format',
  },
  {
    id: 23,
    title: 'Геометрия',
    category: 'Абстракция',
    emoji: '⬡',
    url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=1080&h=1080&fit=crop&auto=format',
  },
  {
    id: 24,
    title: 'Краски',
    category: 'Абстракция',
    emoji: '🎭',
    url: 'https://images.unsplash.com/photo-1519125323398-675f0ddb6308?w=1080&h=1080&fit=crop&auto=format',
  },
  {
    id: 25,
    title: 'Свет',
    category: 'Абстракция',
    emoji: '✦',
    url: 'https://images.unsplash.com/photo-1500462918059-b1a4f0bc7f36?w=1080&h=1080&fit=crop&auto=format',
  },
];

/**
 * Returns a random image, guaranteed to be different from lastId.
 */
export function getRandomImage(lastId) {
  const pool = IMAGES.filter((img) => img.id !== lastId);
  return pool[Math.floor(Math.random() * pool.length)];
}

export { IMAGES };
export default IMAGES;
