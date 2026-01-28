<script setup lang="ts">
import { ref } from 'vue'
import Card from 'primevue/card'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import ProgressSpinner from 'primevue/progressspinner'
import { insertAllTestData, insertTestAdmin } from '@/scripts/insertTestData'

const loading = ref(false)
const adminEmail = ref('')
const adminName = ref('')
const logs = ref<string[]>([])

// Override console.log to capture output
const originalConsoleLog = console.log
const originalConsoleError = console.error

const captureLog = (...args: unknown[]) => {
    const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
    logs.value.push(`[LOG] ${message}`)
    originalConsoleLog.apply(console, args)
}

const captureError = (...args: unknown[]) => {
    const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
    logs.value.push(`[ERROR] ${message}`)
    originalConsoleError.apply(console, args)
}

// Insert all test data
const handleInsertTestData = async () => {
    console.log = captureLog
    console.error = captureError
    logs.value = []
    loading.value = true

    try {
        await insertAllTestData()
        logs.value.push('=== 完了: テストデータの投入が成功しました ===')
    } catch (error) {
        logs.value.push(`=== エラー: ${error} ===`)
    } finally {
        loading.value = false
        console.log = originalConsoleLog
        console.error = originalConsoleError
    }
}

// Create admin
const handleCreateAdmin = async () => {
    if (!adminEmail.value || !adminName.value) {
        logs.value.push('[ERROR] メールアドレスと名前を入力してください')
        return
    }

    console.log = captureLog
    console.error = captureError
    loading.value = true

    try {
        await insertTestAdmin(adminEmail.value, adminName.value)
        logs.value.push(`=== 管理者を作成しました: ${adminName.value} (${adminEmail.value}) ===`)
    } catch (error) {
        logs.value.push(`=== エラー: ${error} ===`)
    } finally {
        loading.value = false
        console.log = originalConsoleLog
        console.error = originalConsoleError
    }
}

// Clear logs
const clearLogs = () => {
    logs.value = []
}
</script>

<template>
    <div class="setup-view">
        <h1>🔧 テストデータセットアップ</h1>
        <p class="warning">⚠️ 本番環境では使用しないでください</p>

        <div class="cards-grid">
            <!-- Admin Creation -->
            <Card>
                <template #header>
                    <div class="card-header">
                        <i class="pi pi-user-plus"></i>
                        <span>管理者アカウント作成</span>
                    </div>
                </template>
                <template #content>
                    <div class="form-group">
                        <label>メールアドレス</label>
                        <InputText v-model="adminEmail" placeholder="admin@example.com" />
                    </div>
                    <div class="form-group">
                        <label>名前</label>
                        <InputText v-model="adminName" placeholder="管理者名" />
                    </div>
                    <Button 
                        label="管理者を作成" 
                        icon="pi pi-plus" 
                        @click="handleCreateAdmin"
                        :loading="loading"
                        class="w-full"
                    />
                </template>
            </Card>

            <!-- Test Data Insertion -->
            <Card>
                <template #header>
                    <div class="card-header">
                        <i class="pi pi-database"></i>
                        <span>テストデータ投入</span>
                    </div>
                </template>
                <template #content>
                    <p>以下のデータを投入します:</p>
                    <ul>
                        <li>キャスト: 8件</li>
                        <li>撮影案件: 5件</li>
                        <li>キャスティング: 10件</li>
                    </ul>
                    <Button 
                        label="テストデータを投入" 
                        icon="pi pi-upload" 
                        severity="warning"
                        @click="handleInsertTestData"
                        :loading="loading"
                        class="w-full"
                    />
                </template>
            </Card>
        </div>

        <!-- Log Output -->
        <Card class="log-card">
            <template #header>
                <div class="card-header">
                    <i class="pi pi-list"></i>
                    <span>実行ログ</span>
                    <Button 
                        icon="pi pi-trash" 
                        text 
                        size="small"
                        @click="clearLogs"
                        v-if="logs.length > 0"
                    />
                </div>
            </template>
            <template #content>
                <div class="log-output">
                    <div v-if="loading" class="loading-indicator">
                        <ProgressSpinner style="width: 30px; height: 30px" />
                        <span>実行中...</span>
                    </div>
                    <div v-else-if="logs.length === 0" class="empty-log">
                        ログはまだありません
                    </div>
                    <div v-else class="log-content">
                        <div 
                            v-for="(log, index) in logs" 
                            :key="index"
                            :class="['log-line', { 'error-line': log.includes('[ERROR]') }]"
                        >
                            {{ log }}
                        </div>
                    </div>
                </div>
            </template>
        </Card>
    </div>
</template>

<style scoped>
.setup-view {
    padding: 2rem;
    max-width: 1000px;
    margin: 0 auto;
}

h1 {
    text-align: center;
    margin-bottom: 0.5rem;
}

.warning {
    text-align: center;
    color: var(--orange-500);
    margin-bottom: 2rem;
    font-weight: 500;
}

.cards-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 1.5rem;
    margin-bottom: 2rem;
}

.card-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem;
    font-weight: 600;
    background: var(--surface-50);
}

.card-header i {
    font-size: 1.25rem;
    color: var(--primary-color);
}

.form-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-bottom: 1rem;
}

.form-group label {
    font-size: 0.875rem;
    font-weight: 500;
}

ul {
    padding-left: 1.25rem;
    margin: 0.5rem 0 1rem;
    color: var(--text-color-secondary);
}

.log-card {
    margin-top: 1rem;
}

.log-output {
    background: var(--surface-900);
    border-radius: 6px;
    padding: 1rem;
    min-height: 200px;
    max-height: 400px;
    overflow-y: auto;
    font-family: monospace;
    font-size: 0.875rem;
}

.loading-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--surface-200);
}

.empty-log {
    color: var(--surface-400);
    text-align: center;
    padding: 2rem;
}

.log-content {
    color: var(--green-400);
}

.log-line {
    padding: 0.125rem 0;
}

.error-line {
    color: var(--red-400);
}
</style>
