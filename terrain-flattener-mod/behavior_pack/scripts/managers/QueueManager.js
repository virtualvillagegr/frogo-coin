// ============================================================================
// QUEUE MANAGER - Manages explosion processing queue for multiplayer safety
// ============================================================================

import { system } from "@minecraft/server";
import { CONFIG } from "../config/config.js";
import { Logger } from "../utils/Logger.js";

/**
 * @typedef {Object} ExplosionData
 * @property {Object} source - TNT entity source
 * @property {Object} dimension - World dimension
 * @property {number} centerX - Center X coordinate
 * @property {number} centerY - Center Y coordinate
 * @property {number} centerZ - Center Z coordinate
 * @property {number} startTime - Start time in milliseconds
 */

export class ExplosionQueueManager {
  constructor() {
    /** @type {Set<string>} */
    this.activeExplosions = new Set();
    /** @type {ExplosionData[]} */
    this.explosionQueue = [];
    /** @type {Map<string, number>} */
    this.processedExplosions = new Map();
  }

  /**
   * Check if we can accept a new explosion
   * @returns {boolean} True if queue not full
   */
  canAddExplosion() {
    return (
      this.activeExplosions.size < CONFIG.queue.maxConcurrent &&
      this.explosionQueue.length < CONFIG.queue.maxSize
    );
  }

  /**
   * Check if explosion is a duplicate
   * @param {number} centerX - X coordinate
   * @param {number} centerY - Y coordinate
   * @param {number} centerZ - Z coordinate
   * @returns {boolean} True if duplicate
   */
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

  /**
   * Add explosion to queue
   * @param {ExplosionData} explosionData - Explosion data
   * @returns {boolean} True if added successfully
   */
  addExplosion(explosionData) {
    // Check for duplicates
    if (
      this.isDuplicate(
        explosionData.centerX,
        explosionData.centerY,
        explosionData.centerZ
      )
    ) {
      Logger.warn("Duplicate explosion ignored");
      return false;
    }

    if (!this.canAddExplosion()) {
      Logger.warn(
        `Queue full (Active: ${this.activeExplosions.size}, Queued: ${this.explosionQueue.length})`
      );
      return false;
    }

    this.explosionQueue.push(explosionData);
    return true;
  }

  /**
   * Process next explosion in queue
   * @param {Function} processFn - Function to process explosion
   * @returns {boolean} True if something was processed
   */
  processNext(processFn) {
    if (
      this.explosionQueue.length === 0 ||
      this.activeExplosions.size >= CONFIG.queue.maxConcurrent
    ) {
      return false;
    }

    const explosionData = this.explosionQueue.shift();
    const explosionId = `${explosionData.centerX}_${explosionData.centerY}_${explosionData.centerZ}_${Date.now()}`;

    this.activeExplosions.add(explosionId);

    system.run(() => {
      try {
        processFn(explosionData);
      } finally {
        this.activeExplosions.delete(explosionId);
      }
    });

    return true;
  }

  /**
   * Get queue status
   * @returns {Object} Queue status
   */
  getStatus() {
    return {
      active: this.activeExplosions.size,
      queued: this.explosionQueue.length,
      canAccept: this.canAddExplosion()
    };
  }

  /**
   * Log queue status
   */
  logStatus() {
    const status = this.getStatus();
    if (status.active > 0 || status.queued > 0) {
      Logger.queue(status.active, status.queued, CONFIG.queue.maxConcurrent);
    }
  }

  /**
   * Clear queue
   */
  clear() {
    this.explosionQueue = [];
    this.activeExplosions.clear();
  }
}
