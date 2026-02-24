<script setup lang="ts">
import { ref, reactive } from 'vue'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import Button from 'primevue/button'
import { useCasts } from '@/composables/useCasts'
import { useToast } from 'primevue/usetoast'
import type { Cast } from '@/types'

const props = defineProps<{
    visible: boolean
}>()

const emit = defineEmits<{
    'update:visible': [value: boolean]
    saved: [cast: Cast]
}>()

const toast = useToast()
const { addCast } = useCasts()
const saving = ref(false)
const nameError = ref(false)

const form = reactive({
    name: '',
    gender: '' as '' | '男性' | '女性',
    agency: '',
    email: '',
    notes: '',
})

const genderOptions = [
    { label: '未選択', value: '' },
    { label: '男性', value: '男性' },
    { label: '女性', value: '女性' },
]

function resetForm() {
    form.name = ''
    form.gender = ''
    form.agency = ''
    form.email = ''
    form.notes = ''
    nameError.value = false
}

async function handleSave() {
    // バリデーション
    if (!form.name.trim()) {
        nameError.value = true
        return
    }
    nameError.value = false
    saving.value = true

    try {
        const castData: Omit<Cast, 'id' | 'createdAt' | 'updatedAt'> = {
            name: form.name.trim(),
            gender: form.gender || '',
            agency: form.agency.trim() || '外部',
            email: form.email.trim(),
            notes: form.notes.trim(),
            castType: '外部',
            imageUrl: '',
            slackMentionId: '',
            appearanceCount: 0,
        }

        // Firestore に保存（onSnapshot リスナーで自動反映される）
        const docId = await addCast(castData)

        // 保存されたキャストデータを親に返す
        const savedCast: Cast = {
            ...castData,
            id: docId || `ext_${Date.now()}`,
        } as Cast

        toast.add({
            severity: 'success',
            summary: '登録完了',
            detail: `外部キャスト「${form.name}」を登録しました`,
            life: 3000
        })

        emit('saved', savedCast)
        emit('update:visible', false)
        resetForm()
    } catch (error) {
        console.error('Failed to save cast:', error)
        toast.add({
            severity: 'error',
            summary: 'エラー',
            detail: 'キャストの登録に失敗しました',
            life: 3000
        })
    } finally {
        saving.value = false
    }
}

function handleClose() {
    emit('update:visible', false)
    resetForm()
}
</script>

<template>
    <Dialog
        :visible="visible"
        @update:visible="emit('update:visible', $event)"
        modal
        header="＋ 新規外部キャストを追加"
        :style="{ width: '480px' }"
        @hide="resetForm"
    >
        <div class="new-cast-form">
            <!-- 名前（必須） -->
            <div class="form-field">
                <label for="new-cast-name">名前 <span class="required">*</span></label>
                <InputText
                    id="new-cast-name"
                    v-model="form.name"
                    placeholder="キャスト名を入力"
                    :class="{ 'p-invalid': nameError }"
                    class="w-full"
                    @input="nameError = false"
                />
                <small v-if="nameError" class="p-error">名前は必須です</small>
            </div>

            <!-- 性別 -->
            <div class="form-field">
                <label for="new-cast-gender">性別</label>
                <Select
                    id="new-cast-gender"
                    v-model="form.gender"
                    :options="genderOptions"
                    optionLabel="label"
                    optionValue="value"
                    placeholder="未選択"
                    class="w-full"
                />
            </div>

            <!-- 所属 -->
            <div class="form-field">
                <label for="new-cast-agency">所属</label>
                <InputText
                    id="new-cast-agency"
                    v-model="form.agency"
                    placeholder="未入力時は「外部」がセットされます"
                    class="w-full"
                />
            </div>

            <!-- メール -->
            <div class="form-field">
                <label for="new-cast-email">メールアドレス</label>
                <InputText
                    id="new-cast-email"
                    v-model="form.email"
                    type="email"
                    placeholder="example@email.com"
                    class="w-full"
                />
            </div>

            <!-- 備考 -->
            <div class="form-field">
                <label for="new-cast-notes">備考</label>
                <Textarea
                    id="new-cast-notes"
                    v-model="form.notes"
                    rows="3"
                    placeholder="メモなど"
                    class="w-full"
                />
            </div>

            <div class="form-info">
                <i class="pi pi-info-circle"></i>
                <span>外部キャストとして登録されます。画像やSNSは登録後に管理画面から編集できます。</span>
            </div>
        </div>

        <template #footer>
            <div class="form-actions">
                <Button label="キャンセル" severity="secondary" @click="handleClose" />
                <Button
                    label="保存してカートに追加"
                    icon="pi pi-check"
                    @click="handleSave"
                    :loading="saving"
                />
            </div>
        </template>
    </Dialog>
</template>

<style scoped>
.new-cast-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.form-field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
}

.form-field label {
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--text-color-secondary);
}

.required {
    color: var(--red-500, #ef4444);
}

.form-info {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.75rem;
    background: var(--blue-50, #eff6ff);
    border-radius: 6px;
    font-size: 0.8rem;
    color: var(--blue-600, #2563eb);
}

.form-info i {
    margin-top: 0.1rem;
}

.form-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
}
</style>
