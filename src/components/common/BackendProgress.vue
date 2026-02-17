<script setup lang="ts">
import { useLoading } from '@/composables/useLoading'

const { isLoading, loadingMessage } = useLoading()
</script>

<template>
  <Transition name="progress-fade">
    <div v-if="isLoading" class="backend-progress">
      <div class="progress-bar">
        <div class="progress-bar-indeterminate"></div>
      </div>
      <div v-if="loadingMessage" class="progress-message">
        {{ loadingMessage }}
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.backend-progress {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
  pointer-events: none;
}

.progress-bar {
  height: 3px;
  background: rgba(102, 126, 234, 0.15);
  overflow: hidden;
}

.progress-bar-indeterminate {
  height: 100%;
  width: 40%;
  background: linear-gradient(90deg, #667eea, #764ba2, #667eea);
  border-radius: 2px;
  animation: indeterminate 1.4s ease-in-out infinite;
}

@keyframes indeterminate {
  0% {
    transform: translateX(-100%);
  }
  50% {
    transform: translateX(150%);
  }
  100% {
    transform: translateX(400%);
  }
}

.progress-message {
  text-align: center;
  padding: 0.35rem 0.75rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(135deg, #667eea, #764ba2);
  backdrop-filter: blur(8px);
  pointer-events: auto;
  animation: slideDown 0.2s ease-out;
}

@keyframes slideDown {
  from {
    transform: translateY(-100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.progress-fade-enter-active {
  animation: slideDown 0.2s ease-out;
}

.progress-fade-leave-active {
  animation: slideDown 0.2s ease-in reverse;
}
</style>
