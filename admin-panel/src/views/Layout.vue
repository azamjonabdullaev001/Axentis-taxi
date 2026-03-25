<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-logo">🚕 Axentis Taxi</div>
      <nav class="sidebar-nav">
        <router-link to="/dashboard" class="nav-item">
          <span class="icon">📊</span> Dashboard
        </router-link>
        <router-link to="/orders" class="nav-item">
          <span class="icon">📋</span> История заказов
        </router-link>
        <router-link to="/revenue" class="nav-item">
          <span class="icon">💰</span> Выручка
        </router-link>
        <router-link to="/pricing" class="nav-item">
          <span class="icon">🏷️</span> Цены
        </router-link>
        <router-link to="/admins" class="nav-item">
          <span class="icon">👤</span> Администраторы
        </router-link>
        <router-link to="/users" class="nav-item">
          <span class="icon">👥</span> Пользователи
        </router-link>

      </nav>
      <button class="logout-btn" @click="logout">🚪 Выйти</button>
    </aside>
    <main class="main-content">
      <router-view />
    </main>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
const router = useRouter()
function logout() {
  localStorage.removeItem('admin_token')
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
  font-size: 18px; font-weight: 800; color: #FFCC00;
  padding: 0 24px 28px;
  border-bottom: 1px solid #333;
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
  padding: 13px 14px;
  border-radius: 12px;
  color: #bbb;
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  transition: background .15s, color .15s;
}
.nav-item:hover { background: #2a2a2a; color: #fff; }
.nav-item.router-link-active { background: #FFCC00; color: #1a1a1a; font-weight: 700; }
.icon { font-size: 16px; }
.logout-btn {
  margin: 0 12px 8px;
  padding: 13px 14px;
  background: transparent;
  border: 1px solid #333;
  border-radius: 12px;
  color: #888;
  font-size: 14px;
  cursor: pointer;
  text-align: left;
  transition: background .15s, color .15s;
}
.logout-btn:hover { background: #2a2a2a; color: #fff; }
.main-content {
  margin-left: 240px;
  flex: 1;
  padding: 32px;
  min-height: 100vh;
}
</style>
