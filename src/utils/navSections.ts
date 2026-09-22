/**
 * Разделы кабинета — единый список для боковой панели и для страницы
 * «Мой профиль», где сотрудник видит, куда ему открыт вход.
 *
 * Держать два списка в разных файлах нельзя: добавили бы раздел в меню, а в
 * перечне доступов его бы не оказалось — и человек считал бы, что доступа нет.
 */
import type { PlanFeatures } from '@/types'

export interface NavSection {
  path: string
  title: string
  icon: string
  /** Раздел из платного тарифа: без него пункт показывается с короной. */
  requiredFeature?: keyof PlanFeatures
  ownerOnly?: boolean
  staffOnly?: boolean
  permission?: string
}

export const MAIN_NAV: NavSection[] = [
  // Свой профиль — первым: для сотрудника это отправная точка дня.
  { path: '/me', title: 'Мой профиль', icon: 'mdi-account-circle-outline', staffOnly: true },
  { path: '/', title: 'Главная', icon: 'mdi-view-dashboard' },
  { path: '/analytics', title: 'Аналитика и отчёты', icon: 'mdi-chart-line', requiredFeature: 'analytics' },
  // Клиенты впереди сделок: работа начинается с человека, сделка — уже следствие.
  { path: '/clients', title: 'Клиенты', icon: 'mdi-account-group' },
  { path: '/deals', title: 'Сделки', icon: 'mdi-briefcase' },
  { path: '/payments', title: 'Платежи', icon: 'mdi-cash-multiple' },
  { path: '/debtors', title: 'Должники', icon: 'mdi-account-alert-outline', requiredFeature: 'debtors' },
  // Партнёры-поставщики — рядом с должниками: оба раздела про деньги, которые
  // ходят между компанией и другой стороной.
  { path: '/suppliers', title: 'Партнёры', icon: 'mdi-handshake-outline', requiredFeature: 'suppliers' },
  { path: '/messages', title: 'Сообщения', icon: 'mdi-message-text-outline', staffOnly: true },
  { path: '/co-investors', title: 'Инвесторы', icon: 'mdi-account-group-outline', requiredFeature: 'coInvestors' },
  // Сотрудники — рядом с инвесторами: оба раздела про людей и их доступ.
  { path: '/staff', title: 'Сотрудники', icon: 'mdi-account-key', ownerOnly: true, requiredFeature: 'staff' },
  { path: '/accounting', title: 'Бухгалтерия', icon: 'mdi-bank-outline', requiredFeature: 'finance' },
  // Кассы — рядом с бухгалтерией: там же смотрят, где лежат деньги.
  { path: '/cashboxes', title: 'Кассы', icon: 'mdi-wallet-outline', requiredFeature: 'finance' },
  { path: '/broadcasts', title: 'Чаты и рассылки', icon: 'mdi-whatsapp', requiredFeature: 'whatsapp' },
  { path: '/registry', title: 'Реестр клиентов', icon: 'mdi-shield-account', requiredFeature: 'registry' },
]

export const SECONDARY_NAV: NavSection[] = [
  // Копии — с Бизнеса (1 копия), на Премиуме их 5. Ниже пункт показывается с
  // короной: раньше он был открыт на любом тарифе, а сервер потом отказывал.
  { path: '/backups', title: 'Резервные копии', icon: 'mdi-content-save-outline', requiredFeature: 'backups' },
  { path: '/help', title: 'Справка', icon: 'mdi-help-circle-outline' },
  { path: '/settings', title: 'Настройки', icon: 'mdi-cog' },
]
