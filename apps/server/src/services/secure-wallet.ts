import crypto from 'crypto';

export interface EncryptedKey {
  ciphertext: string;
  iv: string;
  authTag: string;
  version: number;
}

export class SecureWalletService {
  private masterKey: Buffer;

  constructor() {
    const keyHex = process.env.MASTER_ENCRYPTION_KEY;

    if (!keyHex) {
      console.warn(
        'WARNING: MASTER_ENCRYPTION_KEY not set. Using insecure default for development.'
      );
      // Generate a deterministic key for development only
      this.masterKey = crypto.scryptSync('dev-only-insecure-key', 'salt', 32);
    } else if (keyHex.length !== 64) {
      throw new Error(
        'MASTER_ENCRYPTION_KEY must be 64 hex characters (32 bytes)'
      );
    } else {
      this.masterKey = Buffer.from(keyHex, 'hex');
    }
  }

  /**
   * Derive a user-specific encryption key using HKDF
   * This ensures that even if one user's data is compromised,
   * other users' keys remain secure
   */
  private deriveUserKey(userId: string): Buffer {
    return Buffer.from(crypto.hkdfSync(
      'sha256',
      this.masterKey,
      Buffer.from(userId), // Salt: unique per user
      Buffer.from('migratorrr-wallet-v1'), // Context info
      32 // Key length
    ));
  }

  /**
   * Encrypt a private key using AES-256-GCM
   * GCM provides authenticated encryption (integrity + confidentiality)
   */
  async encryptPrivateKey(
    privateKey: Uint8Array,
    userId: string
  ): Promise<EncryptedKey> {
    const userKey = this.deriveUserKey(userId);
    const iv = crypto.randomBytes(12); // 96-bit nonce for GCM

    const cipher = crypto.createCipheriv('aes-256-gcm', userKey, iv);

    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(privateKey)),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    // Zero out the user key from memory
    userKey.fill(0);

    return {
      ciphertext: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      version: 1,
    };
  }

  /**
   * Decrypt a private key
   * Should only be called momentarily when signing transactions
   */
  async decryptPrivateKey(
    encrypted: EncryptedKey,
    userId: string
  ): Promise<Uint8Array> {
    const userKey = this.deriveUserKey(userId);

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      userKey,
      Buffer.from(encrypted.iv, 'base64')
    );

    decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
      decipher.final(),
    ]);

    // Zero out the user key
    userKey.fill(0);

    return new Uint8Array(decrypted);
  }

  /**
   * Re-encrypt a key with a new version (for key rotation)
   */
  async rotateKey(
    encrypted: EncryptedKey,
    userId: string
  ): Promise<EncryptedKey> {
    // Decrypt with current key
    const privateKey = await this.decryptPrivateKey(encrypted, userId);

    // Re-encrypt (would use new master key in production)
    const newEncrypted = await this.encryptPrivateKey(privateKey, userId);

    // Zero out decrypted key
    privateKey.fill(0);

    return {
      ...newEncrypted,
      version: encrypted.version + 1,
    };
  }
}
