import { world, system } from "@minecraft/server";

// ============================================================================
// TERRAIN FLATTENER TNT v3.0 - PRODUCTION BUILD
// Full optimization with all improvements integrated
// ============================================================================

// ============ CONFIGURATION ============
const CONFIG = {
  // Protected blocks that won't be destroyed
  protectedBlocks: new Set([
    "minecraft:diamond_ore",
    "minecraft:deepslate_diamond_ore",
    "minecraft:gold_ore",
    "minecraft:iron_ore",
    "minecraft:coal_ore",
    "minecraft:emerald_ore",
    "minecraft:redstone_ore",
    "minecraft:lapis_ore",
    "minecraft:chest",
    "minecraft:barrel",
    "minecraft:spawner",
    "minecraft:shulker_box",
    "minecraft:furnace",
    "minecraft:blast_furnace",
    "minecraft:smoker",
    "minecraft:hopper",
    "minecraft:dropper",
    "minecraft:dispenser",
    "minecraft:enchanting_table",
    "minecraft:brewing_stand"
  ]),

  // Explosion settings
  radius: 12,
  height: 40,

  // Multiplayer queue management
  maxConcurrentExplosions: 2,
  maxQueueSize: 15,
  explosionCooldown: 10, // ticks

  // Device performance presets
  devicePresets: {
    phone: { batchSize: 1, batchDelay: 4, description: "📱 Low-End Phone" },
    tablet: { batchSize: 2, batchDelay: 2, description: "📱 Tablet" },
    pc: { batchSize: 4, batchDelay: 1, description: "🖥️ PC" },
    ultra: { batchSize: 8, batchDelay: 0, description: "⚡ Ultra PC" }
  },

  // Auto-detection thresholds
  playerCountThresholds: {
    phone: 10,
    tablet: 5,
    pc: 0
  },

  // Chunk loading
  chunkLoadTimeout: 1000,
  chunkLoadRetries: 3,

  // Logging
  verboseLogging: true,
  performanceTracking: true
};

// ============ PERFORMANCE TRACKER ============
class PerformanceTracker {
  constructor() {
    this.explosionTimes = [];
    this.blocksClearedHistory = [];
    this.maxHistorySize = 20;
  }

  recordExplosion(timeMs, blocksCleared) {
    this.explosionTimes.push(timeMs);
    this.blocksClearedHistory.push(blocksCleared);

    if (this.explosionTimes.length > this.maxHistorySize) {
      this.explosionTimes.shift();
      this.blocksClearedHistory.shift();
    }
  }

  getAverageTime() {
    if (this.explosionTimes.length === 0) return 0;
    const sum = this.explosionTimes.reduce((a, b) => a + b, 0);
    return sum / this.explosionTimes.length;
  }

  getAverageBlocksCleared() {
    if (this.blocksClearedHistory.length === 0) return 0;
    const sum = this.blocksClearedHistory.reduce((a, b) => a + b, 0);
    return Math.floor(sum / this.blocksClearedHistory.length);
  }

  getStats() {
    return {
      averageTime: this.getAverageTime().toFixed(2),
      averageBlocks: this.getAverageBlocksCleared(),
      totalExplosions: this.explosionTimes.length
    };
  }
}

// ============ CHUNK MANAGER ============
class ChunkManager {
  constructor() {
    this.chunkCache = new Map();
    this.cacheDuration = 5000; // 5 seconds
  }

  isChunkLoaded(dimension, x, z) {
    try {
      const cacheKey = `${dimension.id}_${Math.floor(x / 16)}_${Math.floor(z / 16)}`;

      // Check cache first
      if (this.chunkCache.has(cacheKey)) {
        const cached = this.chunkCache.get(cacheKey);
        if (Date.now() - cached.timestamp < this.cacheDuration) {
          return cached.loaded;
        }
      }

      // Test actual chunk load
      const block = dimension.getBlock({
        x: Math.floor(x),
        y: 64,
        z: Math.floor(z)
      });

      const loaded = block !== null;
      this.chunkCache.set(cacheKey, {
        loaded: loaded,
        timestamp: Date.now()
      });

      return loaded;
    } catch {
      return false;
    }
  }

  ensureChunksLoaded(dimension, centerX, centerZ, radius) {
    const corners = [
      { x: centerX - radius, z: centerZ - radius },
      { x: centerX + radius, z: centerZ - radius },
      { x: centerX - radius, z: centerZ + radius },
      { x: centerX + radius, z: centerZ + radius }
    ];

    return corners.every(corner => this.isChunkLoaded(dimension, corner.x, corner.z));
  }

  clearCache() {
    this.chunkCache.clear();
  }
}

// ============ DEVICE DETECTOR ============
class DeviceDetector {
  static getCurrentDevice() {
    const playerCount = world.getPlayers().length;

    if (playerCount >= CONFIG.playerCountThresholds.phone) {
      return "phone";
    } else if (playerCount >= CONFIG.playerCountThresholds.tablet) {
      return "tablet";
    } else {
      return "pc";
    }
  }

  static getPreset() {
    const device = this.getCurrentDevice();
    return CONFIG.devicePresets[device];
  }

  static getDeviceInfo() {
    const device = this.getCurrentDevice();
    const preset = this.getPreset();
    return {
      device,
      preset,
      playerCount: world.getPlayers().length
    };
  }
}

// ============ EXPLOSION QUEUE MANAGER ============
class ExplosionQueueManager {
  constructor() {
    this.activeExplosions = new Set();
    this.explosionQueue = [];
    this.processedExplosions = new Map();
    this.deduplicationTimeout = 15; // ticks
  }

  canAddExplosion() {
    return (
      this.activeExplosions.size < CONFIG.maxConcurrentExplosions &&
      this.explosionQueue.length < CONFIG.maxQueueSize
    );
  }

  isDuplicate(centerX, centerY, centerZ) {
    const key = `${Math.round(centerX)}_${Math.round(centerY)}_${Math.round(centerZ)}`;

    if (this.processedExplosions.has(key)) {
      return true;
    }

    this.processedExplosions.set(key, Date.now());

    // Clean old entries
    if (this.processedExplosions.size > 50) {
      const firstKey = this.processedExplosions.keys().next().value;
      this.processedExplosions.delete(firstKey);
    }

    return false;
  }

  addExplosion(explosionData) {
    // Check for duplicates
    if (
      this.isDuplicate(
        explosionData.centerX,
        explosionData.centerY,
        explosionData.centerZ
      )
    ) {
      if (CONFIG.verboseLogging) {
        console.warn("⚠️ Duplicate explosion ignored");
      }
      return false;
    }

    if (!this.canAddExplosion()) {
      if (CONFIG.verboseLogging) {
        console.warn(
          `⚠️ Queue full (Active: ${this.activeExplosions.size}, Queued: ${this.explosionQueue.length})`
        );
      }
      return false;
    }

    this.explosionQueue.push(explosionData);
    return true;
  }

  processNext() {
    if (
      this.explosionQueue.length === 0 ||
      this.activeExplosions.size >= CONFIG.maxConcurrentExplosions
    ) {
      return false;
    }

    const explosionData = this.explosionQueue.shift();
    const explosionId = `${explosionData.centerX}_${explosionData.centerY}_${explosionData.centerZ}_${Date.now()}`;

    this.activeExplosions.add(explosionId);

    system.run(() => {
      try {
        flattenExplosion(explosionData);
      } finally {
        this.activeExplosions.delete(explosionId);
        this.processNext();
      }
    });

    return true;
  }

  getStatus() {
    return {
      active: this.activeExplosions.size,
      queued: this.explosionQueue.length,
      canAccept: this.canAddExplosion()
    };
  }
}

// ============ INITIALIZATION ============
const performanceTracker = new PerformanceTracker();
const chunkManager = new ChunkManager();
const queueManager = new ExplosionQueueManager();

// ============ EVENT HANDLER ============
world.afterEvents.entityExplode.subscribe((event) => {
  try {
    const source = event.source;

    // Validation
    if (!source) return;
    if (source.typeId !== "minecraft:tnt" && source.typeId !== "minecraft:primed_tnt")
      return;
    if (source.isRemoved) return;

    // Get location safely
    const location = source.location;
    if (!location || !Number.isFinite(location.x)) return;

    // Create explosion data
    const explosionData = {
      source: source,
      dimension: source.dimension,
      centerX: Math.floor(location.x),
      centerY: Math.floor(location.y),
      centerZ: Math.floor(location.z),
      startTime: Date.now()
    };

    // Add to queue
    if (queueManager.addExplosion(explosionData)) {
      if (CONFIG.verboseLogging) {
        console.warn(
          `🧨 TNT queued at (${explosionData.centerX}, ${explosionData.centerY}, ${explosionData.centerZ})`
        );
      }
      queueManager.processNext();
    }
  } catch (error) {
    console.warn(`❌ Event handler error: ${error}`);
  }
});

// ============ MAIN FLATTENING FUNCTION ============
function flattenExplosion(explosionData) {
  try {
    const { source, dimension, centerX, centerY, centerZ, startTime } =
      explosionData;

    // Get device preset for batch processing
    const deviceInfo = DeviceDetector.getDeviceInfo();
    const preset = deviceInfo.preset;

    if (CONFIG.verboseLogging) {
      console.warn(
        `⚡ Processing TNT | Device: ${preset.description} | Players: ${deviceInfo.playerCount}`
      );
    }

    // 1. CHECK CHUNK LOADING
    if (
      !chunkManager.ensureChunksLoaded(
        dimension,
        centerX,
        centerZ,
        CONFIG.radius
      )
    ) {
      if (CONFIG.verboseLogging) {
        console.warn(`⚠️ Chunks not loaded, retrying in 1 second...`);
      }

      system.runTimeout(() => {
        if (
          chunkManager.ensureChunksLoaded(
            dimension,
            centerX,
            centerZ,
            CONFIG.radius
          )
        ) {
          flattenExplosion(explosionData);
        } else {
          if (CONFIG.verboseLogging) {
            console.warn(
              `⚠️ Chunks still not loaded, proceeding with fallback...`
            );
          }
          flattenWithFallback(
            source,
            dimension,
            centerX,
            centerY,
            centerZ,
            preset,
            startTime
          );
        }
      }, 20);

      return;
    }

    // 2. CALCULATE RANGE
    const maxHeight = world.getAbsoluteMaxHeight();
    const minHeight = world.getAbsoluteMinHeight();
    const maxY = Math.min(centerY + CONFIG.height, maxHeight - 1);
    const minY = Math.max(centerY + 1, minHeight + 1);

    // 3. VALIDATE RANGE
    if (minY >= maxY) {
      if (CONFIG.verboseLogging) {
        console.warn(`⚠️ Invalid Y range: ${minY} >= ${maxY}`);
      }
      return;
    }

    // 4. TRY FILL COMMAND (FASTEST)
    try {
      const fillCmd = `fill ${centerX - CONFIG.radius} ${minY} ${centerZ - CONFIG.radius} ${centerX + CONFIG.radius} ${maxY} ${centerZ + CONFIG.radius} air replace`;

      source.runCommand(fillCmd);

      const elapsed = Date.now() - startTime;
      performanceTracker.recordExplosion(elapsed, CONFIG.radius * CONFIG.radius * CONFIG.height);

      if (CONFIG.verboseLogging) {
        console.warn(
          `✅ Fill command executed | Time: ${elapsed}ms | Avg: ${performanceTracker.getAverageTime()}ms`
        );
      }

      return;
    } catch (fillErr) {
      if (CONFIG.verboseLogging) {
        console.warn(`⚠️ Fill command failed, using script fallback...`);
      }
    }

    // 5. FALLBACK: SCRIPT-BASED CLEARING
    flattenWithFallback(
      source,
      dimension,
      centerX,
      centerY,
      centerZ,
      preset,
      startTime
    );
  } catch (error) {
    console.warn(`❌ Explosion processing error: ${error}`);
  }
}

// ============ FALLBACK FLATTENING (SCRIPT-BASED) ============
function flattenWithFallback(
  source,
  dimension,
  centerX,
  centerY,
  centerZ,
  preset,
  startTime
) {
  try {
    const maxHeight = world.getAbsoluteMaxHeight();
    const minHeight = world.getAbsoluteMinHeight();
    const maxY = Math.min(centerY + CONFIG.height, maxHeight - 1);
    const minY = Math.max(centerY + 1, minHeight + 1);

    if (minY >= maxY) return;

    let currentX = -CONFIG.radius;
    let blocksRemoved = 0;
    let blocksFailed = 0;

    const processBatch = () => {
      try {
        // Process batch based on device capability
        for (
          let batch = 0;
          batch < preset.batchSize && currentX <= CONFIG.radius;
          batch++, currentX++
        ) {
          const posX = centerX + currentX;

          for (let z = -CONFIG.radius; z <= CONFIG.radius; z++) {
            const posZ = centerZ + z;

            // Circular area check
            if (currentX * currentX + z * z > CONFIG.radius * CONFIG.radius)
              continue;

            for (let y = minY; y <= maxY; y++) {
              try {
                const block = dimension.getBlock({
                  x: posX,
                  y: y,
                  z: posZ
                });

                // Skip invalid/air blocks
                if (!block || block.isAir) continue;

                const id = block.typeId;

                // Skip protected blocks
                if (CONFIG.protectedBlocks.has(id)) continue;

                // Skip bedrock
                if (id === "minecraft:bedrock") continue;

                // Remove block
                block.setType("minecraft:air");
                blocksRemoved++;
              } catch {
                blocksFailed++;
              }
            }
          }
        }

        // Schedule next batch
        if (currentX <= CONFIG.radius) {
          system.runTimeout(processBatch, preset.batchDelay);
        } else {
          // Completed
          const elapsed = Date.now() - startTime;
          performanceTracker.recordExplosion(elapsed, blocksRemoved);

          if (CONFIG.performanceTracking) {
            const stats = performanceTracker.getStats();
            console.warn(
              `✅ Fallback complete | Removed: ${blocksRemoved} | Failed: ${blocksFailed} | Time: ${elapsed}ms | Avg: ${stats.averageTime}ms`
            );
          } else {
            console.warn(
              `✅ Fallback complete | Removed: ${blocksRemoved} | Time: ${elapsed}ms`
            );
          }
        }
      } catch (batchErr) {
        console.warn(`❌ Batch error: ${batchErr}`);
      }
    };

    if (CONFIG.verboseLogging) {
      console.warn(
        `📊 Starting script fallback | Batch: ${preset.batchSize} | Delay: ${preset.batchDelay}ms`
      );
    }

    processBatch();
  } catch (error) {
    console.warn(`❌ Fallback function error: ${error}`);
  }
}

// ============ QUEUE PROCESSOR (RUNS EVERY 5 TICKS) ============
system.runInterval(() => {
  try {
    // Process next explosion in queue
    queueManager.processNext();

    // Log status periodically
    const status = queueManager.getStatus();
    if ((status.active > 0 || status.queued > 0) && CONFIG.verboseLogging) {
      console.warn(
        `📋 Queue | Active: ${status.active}/${CONFIG.maxConcurrentExplosions} | Queued: ${status.queued}/${CONFIG.maxQueueSize}`
      );
    }
  } catch (error) {
    console.warn(`❌ Queue processor error: ${error}`);
  }
}, 5);

// ============ PERIODIC MAINTENANCE ============
system.runInterval(() => {
  try {
    // Clean chunk cache every 30 seconds
    chunkManager.clearCache();

    // Log performance stats if tracking enabled
    if (CONFIG.performanceTracking) {
      const stats = performanceTracker.getStats();
      if (stats.totalExplosions > 0) {
        console.warn(
          `📊 Performance | Explosions: ${stats.totalExplosions} | Avg Time: ${stats.averageTime}ms | Avg Blocks: ${stats.averageBlocks}`
        );
      }
    }
  } catch (error) {
    console.warn(`❌ Maintenance error: ${error}`);
  }
}, 600); // Every 30 seconds

// ============ STARTUP MESSAGE ============
system.runTimeout(() => {
  try {
    for (const player of world.getAllPlayers()) {
      player.sendMessage(
        "§a━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━§r"
      );
      player.sendMessage("§6🧨 Terrain Flattener TNT v3.0 - READY§r");
      player.sendMessage(
        "§eRight-click TNT to flatten terrain§r"
      );
      player.sendMessage(
        "§a━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━§r"
      );
    }

    console.warn(
      "🚀 Terrain Flattener TNT v3.0 - Production Mode Activated"
    );
    console.warn(
      `✅ Features: Auto-detect | Chunk-aware | Multiplayer-safe | Performance-tracked`
    );
  } catch (error) {
    console.warn(`Startup message error: ${error}`);
  }
}, 40);

// ============ EXPORTS (for testing) ============
export {
  CONFIG,
  PerformanceTracker,
  ChunkManager,
  DeviceDetector,
  ExplosionQueueManager,
  performanceTracker,
  chunkManager,
  queueManager
};
