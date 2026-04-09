import { createRouter, createWebHistory } from 'vue-router'
import Login from '../views/Login.vue'
import Layout from '../views/Layout.vue'
import Dashboard from '../views/Dashboard.vue'
import Orders from '../views/Orders.vue'
import Revenue from '../views/Revenue.vue'
import Pricing from '../views/Pricing.vue'
import Admins from '../views/Admins.vue'
import Users from '../views/Users.vue'
import Dispatcher from '../views/Dispatcher.vue'
import Referrals from '../views/Referrals.vue'
import DriverDetail from '../views/DriverDetail.vue'

const routes = [
  { path: '/login', component: Login, meta: { public: true } },
  {
    path: '/',
    component: Layout,
    meta: { requiresAuth: true },
    children: [
      { path: '', redirect: '/dashboard' },
      { path: 'dashboard', component: Dashboard },
      { path: 'orders', component: Orders, meta: { allowedRoles: ['superadmin', 'orders'] } },
      { path: 'revenue', component: Revenue, meta: { allowedRoles: ['superadmin', 'revenue'] } },
      { path: 'pricing', component: Pricing, meta: { allowedRoles: ['superadmin', 'pricing'] } },
      { path: 'admins', component: Admins, meta: { allowedRoles: ['superadmin'] } },
      { path: 'users', component: Users, meta: { allowedRoles: ['superadmin', 'users'] } },
      { path: 'dispatcher', component: Dispatcher, meta: { allowedRoles: ['superadmin', 'dispatcher'] } },
      { path: 'referrals', component: Referrals, meta: { allowedRoles: ['superadmin', 'referrals'] } },
      { path: 'drivers/:id', component: DriverDetail, meta: { allowedRoles: ['superadmin', 'users'] } },
    ]
  },
  { path: '/:pathMatch(.*)*', redirect: '/' }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to) => {
  const token = localStorage.getItem('admin_token')
  if (!to.meta.public && !token) return '/login'
  if (to.path === '/login' && token) return '/dashboard'

  // Role-based route guard
  const allowedRoles = to.meta.allowedRoles
  if (allowedRoles && token) {
    const role = localStorage.getItem('admin_role') || 'superadmin'
    if (!allowedRoles.includes(role)) {
      return '/dashboard'
    }
  }
})

export default router
