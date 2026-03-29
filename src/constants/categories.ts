import type { CategoryItem } from '@/types'

export const CATEGORIES: CategoryItem[] = [
  { id: 'ELECTRONICS', label: 'Электроника', icon: 'mdi-cellphone' },
  { id: 'APPLIANCES', label: 'Бытовая техника', icon: 'mdi-television' },
  { id: 'FURNITURE', label: 'Мебель', icon: 'mdi-bed' },
  { id: 'AUTO', label: 'Авто', icon: 'mdi-car' },
  { id: 'CLOTHING', label: 'Одежда', icon: 'mdi-tshirt-crew' },
  { id: 'CONSTRUCTION', label: 'Стройматериалы', icon: 'mdi-hammer-wrench' },
  { id: 'MEDICAL', label: 'Медицина', icon: 'mdi-medical-bag' },
  { id: 'EDUCATION', label: 'Образование', icon: 'mdi-school' },
  { id: 'OTHER', label: 'Другое', icon: 'mdi-dots-horizontal-circle-outline' },
]

export const getCategoryLabel = (id: string): string => {
  return CATEGORIES.find((c) => c.id === id)?.label ?? 'Другое'
}
