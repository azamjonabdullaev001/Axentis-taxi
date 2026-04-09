<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-logo">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="#FFCC00" style="flex-shrink:0">
          <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>
        </svg>
        <span>Axentis Taxi</span>
      </div>
      <nav class="sidebar-nav">
        <router-link v-if="isRouteAllowed('/dashboard')" to="/dashboard" class="nav-item">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          Dashboard
        </router-link>
        <router-link v-if="isRouteAllowed('/orders')" to="/orders" class="nav-item">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>
          История заказов
        </router-link>
        <router-link v-if="isRouteAllowed('/dispatcher')" to="/dispatcher" class="nav-item">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
          Диспетчер
        </router-link>
        <router-link v-if="isRouteAllowed('/revenue')" to="/revenue" class="nav-item">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
          Выручка
        </router-link>
        <router-link v-if="isRouteAllowed('/pricing')" to="/pricing" class="nav-item">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
          Цены
        </router-link>
        <router-link v-if="isRouteAllowed('/admins')" to="/admins" class="nav-item">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Администраторы
        </router-link>
        <router-link v-if="isRouteAllowed('/users')" to="/users" class="nav-item">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
          Пользователи
        </router-link>
        <router-link v-if="isRouteAllowed('/referrals')" to="/referrals" class="nav-item">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><path d="M12 22V7M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/></svg>
          Рефералы / Бонусы
        </router-link>
      </nav>
      <button class="logout-btn" @click="logout">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>
        Выйти
      </button>
    </aside>
    <main class="main-content">
      <router-view />
    </main>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { ref, computed } from 'vue'

const router = useRouter()
const adminRole = ref(localStorage.getItem('admin_role') || 'superadmin')

// Role-to-allowed-routes mapping
// superadmin has access to everything
// other roles only see their specific section + dashboard
const roleRoutes = {
  superadmin: null, // null = all routes allowed
  dispatcher: ['/dashboard', '/dispatcher'],
  orders: ['/dashboard', '/orders'],
  revenue: ['/dashboard', '/revenue'],
  pricing: ['/dashboard', '/pricing'],
  users: ['/dashboard', '/users'],
  referrals: ['/dashboard', '/referrals'],
}

function isRouteAllowed(path) {
  const allowed = roleRoutes[adminRole.value]
  if (!allowed) return true // superadmin
  return allowed.some(r => path.startsWith(r))
}

function logout() {
  localStorage.removeItem('admin_token')
  localStorage.removeItem('admin_role')
  router.push('/login')
}
</script>

<style scoped>
.layout { display: flex; min-height: 100vh; background: #f5f6fa; }
.sidebar {
  width: 240px;
  min-height: 100vh;
  background: #1a1a1a;
  display: flex;
  flex-direction: column;
  padding: 24px 0;
  position: fixed;
  top: 0; left: 0;
  z-index: 100;
}
.sidebar-logo {
  display: flex; align-items: center; gap: 10px;
  font-size: 17px; font-weight: 800; color: #FFCC00;
  padding: 0 24px 28px;
  border-bottom: 1px solid #2a2a2a;
  letter-spacing: 0.3px;
}
.sidebar-nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 20px 12px;
  gap: 4px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
  border-radius: 10px;
  color: #888;
  text-decoration: none;
  font-size: 13.5px;
  font-weight: 500;
  transition: background .15s, color .15s;
  border-left: 3px solid transparent;
}
.nav-item:hover { background: #222; color: #fff; }
.nav-item.router-link-active {
  background: rgba(255,204,0,0.12);
  color: #FFCC00;
  font-weight: 700;
  border-left-color: #FFCC00;
}
.nav-icon { width: 18px; height: 18px; flex-shrink: 0; }
.logout-btn {
  margin: 0 12px 8px;
  padding: 13px 14px;
  background: transparent;
  border: 1px solid #2a2a2a;
  border-radius: 12px;
  color: #888;
  font-size: 14px;
  cursor: pointer;
  text-align: left;
  display: flex; align-items: center; gap: 10px;
  transition: background .15s, color .15s;
  width: calc(100% - 24px);
}
.logout-btn:hover { background: #2a2a2a; color: #f44336; }
.main-content {
  margin-left: 240px;
  flex: 1;
  padding: 32px;
  min-height: 100vh;
}
</style>
