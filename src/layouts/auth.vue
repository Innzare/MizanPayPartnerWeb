<template>
  <v-app>
    <router-view />
    <!-- <v-main class="auth-layout">
      <v-container class="fill-height" fluid>
        <v-row align="center" justify="center">
          <v-col cols="12" sm="12">
            <div class="text-center mb-8">
              <v-avatar size="80" color="primary" class="mb-4">
                <v-icon size="50" color="white"
                  >mdi-silverware-fork-knife</v-icon
                >
              </v-avatar>
              <h1 class="text-h4 font-weight-bold text-white mb-2">
                Restaurant Admin
              </h1>
              <p class="text-subtitle-1 text-white opacity-80">
                Система управления рестораном
              </p>
            </div>

            <router-view />

            <div class="text-center mt-8">
              <p class="text-caption text-white opacity-60">
                &copy; {{ new Date().getFullYear() }} Restaurant Admin. Все
                права защищены.
              </p>
            </div>
          </v-col>
        </v-row>
      </v-container>
    </v-main> -->
  </v-app>
</template>

<script setup lang="ts">
// Минималистичный layout без навигации
</script>

<style scoped>
.auth-layout {
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  position: relative;
  overflow: hidden;
}

.auth-layout::before {
  /* content: "";
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%; */
  background: radial-gradient(
    circle,
    rgba(255, 255, 255, 0.1) 1px,
    transparent 1px
  );
  background-size: 50px 50px;
  animation: moveBackground 20s linear infinite;
}

@keyframes moveBackground {
  0% {
    transform: translate(0, 0);
  }
  100% {
    transform: translate(50px, 50px);
  }
}

.fill-height {
  min-height: 100vh;
  position: relative;
  z-index: 1;
}

.opacity-80 {
  opacity: 0.8;
}

.opacity-60 {
  opacity: 0.6;
}
</style>
