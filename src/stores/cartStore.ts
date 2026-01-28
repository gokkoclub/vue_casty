import { defineStore } from 'pinia'
import type { Cast, CartItem, CartMeta } from '@/types'

export const useCartStore = defineStore('cart', {
    state: () => ({
        items: [] as CartItem[],
        meta: {
            accountName: '',
            projectName: '',
            notionUrl: '',
            dateRanges: [] as string[]
        } as CartMeta
    }),

    getters: {
        count: (state) => state.items.length,
        isEmpty: (state) => state.items.length === 0,

        groupedByProject: (state) => {
            const groups: Record<string, CartItem[]> = {}
            for (const item of state.items) {
                const project = item.projectName || '未分類'
                if (!groups[project]) groups[project] = []
                groups[project].push(item)
            }
            return groups
        }
    },

    actions: {
        addItem(cast: Cast, options?: Partial<CartItem>) {
            if (this.items.some(i => i.castId === cast.id)) return
            this.items.push({
                tempId: `temp-${Date.now()}-${cast.id}`,
                castId: cast.id,
                cast,
                roleName: options?.roleName ?? '',
                rank: this.items.length + 1,
                note: options?.note ?? '',
                mainSub: options?.mainSub ?? 'その他',
                projectName: options?.projectName ?? ''
            })
        },

        removeItem(castId: string) {
            const idx = this.items.findIndex(i => i.castId === castId)
            if (idx !== -1) {
                this.items.splice(idx, 1)
                // Re-rank
                this.items.forEach((item, i) => item.rank = i + 1)
            }
        },

        updateItem(castId: string, data: Partial<CartItem>) {
            const item = this.items.find(i => i.castId === castId)
            if (item) {
                Object.assign(item, data)
            }
        },

        updateMeta(meta: Partial<CartMeta>) {
            Object.assign(this.meta, meta)
        },

        reorder(fromIndex: number, toIndex: number) {
            const item = this.items.splice(fromIndex, 1)[0]
            if (item) {
                this.items.splice(toIndex, 0, item)
                this.items.forEach((item, i) => item.rank = i + 1)
            }
        },

        clear() {
            this.items = []
            this.meta = {
                accountName: '',
                projectName: '',
                notionUrl: '',
                dateRanges: []
            }
        }
    }
})
