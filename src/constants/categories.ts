import type { CategoryItem } from '@/types'

export const CATEGORIES: CategoryItem[] = [
  { id: 'electronics', label: 'Электроника', icon: 'mdi-cellphone' },
  { id: 'appliances', label: 'Бытовая техника', icon: 'mdi-television' },
  { id: 'furniture', label: 'Мебель', icon: 'mdi-bed' },
  { id: 'auto', label: 'Авто', icon: 'mdi-car' },
  { id: 'clothing', label: 'Одежда', icon: 'mdi-tshirt-crew' },
  { id: 'construction', label: 'Стройматериалы', icon: 'mdi-hammer-wrench' },
  { id: 'medical', label: 'Медицина', icon: 'mdi-medical-bag' },
  { id: 'education', label: 'Образование', icon: 'mdi-school' },
  { id: 'other', label: 'Другое', icon: 'mdi-dots-horizontal-circle-outline' },
]

export const getCategoryLabel = (id: string): string => {
  return CATEGORIES.find((c) => c.id === id)?.label ?? 'Другое'
}
