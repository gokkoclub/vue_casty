import { ref, computed } from 'vue'

/**
 * 一括選択機能を提供するcomposable
 * キャスティング状況画面での一括操作に使用
 */
export function useBulkSelection() {
    // State
    const bulkSelectMode = ref(false)
    const selectedIds = ref<Set<string>>(new Set())

    // Computed
    const selectedCount = computed(() => selectedIds.value.size)
    const hasSelection = computed(() => selectedIds.value.size > 0)

    // Actions
    const toggleMode = () => {
        bulkSelectMode.value = !bulkSelectMode.value
        if (!bulkSelectMode.value) {
            selectedIds.value.clear()
        }
    }

    const toggleSelect = (id: string) => {
        if (selectedIds.value.has(id)) {
            selectedIds.value.delete(id)
        } else {
            selectedIds.value.add(id)
        }
        // Trigger reactivity
        selectedIds.value = new Set(selectedIds.value)
    }

    const selectAll = (ids: string[]) => {
        ids.forEach(id => selectedIds.value.add(id))
        selectedIds.value = new Set(selectedIds.value)
    }

    const clearSelection = () => {
        selectedIds.value.clear()
        selectedIds.value = new Set(selectedIds.value)
    }

    const isSelected = (id: string) => selectedIds.value.has(id)

    const getSelectedIds = () => Array.from(selectedIds.value)

    return {
        bulkSelectMode,
        selectedIds,
        selectedCount,
        hasSelection,
        toggleMode,
        toggleSelect,
        selectAll,
        clearSelection,
        isSelected,
        getSelectedIds
    }
}
