import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import prompts from 'prompts';

const APPDATA_PATH = process.env.APPDATA;
const PRIMORDIALIS_DIR = path.join(APPDATA_PATH, 'Primordialis');
const DEFAULT_SAVE_NAME = 'save';

async function getSaveFolders() {
  try {
    const entries = await fs.readdir(PRIMORDIALIS_DIR, { withFileTypes: true });
    const saveFolders = entries
      .filter(entry => entry.isDirectory() && entry.name.startsWith('save'));

    // Get stats for each folder to get modification time
    const foldersWithStats = await Promise.all(
      saveFolders.map(async (entry) => {
        const folderPath = path.join(PRIMORDIALIS_DIR, entry.name);
        try {
          const stats = await fs.stat(folderPath);
          return {
            name: entry.name,
            mtime: stats.mtime
          };
        } catch {
          return {
            name: entry.name,
            mtime: new Date(0) // Fallback if stat fails
          };
        }
      })
    );

    // Sort by modification time, newest first
    foldersWithStats.sort((a, b) => b.mtime - a.mtime);

    return foldersWithStats;
  } catch (error) {
    console.error('Error reading Primordialis directory:', error.message);
    return [];
  }
}

async function selectSave(saveFolders) {
  if (saveFolders.length === 0) {
    console.log('No save folders found in', PRIMORDIALIS_DIR);
    return null;
  }

  const choices = saveFolders.map(folder => {
    const dateStr = folder.mtime.toLocaleString('de-DE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    return {
      title: `${folder.name} (${dateStr})`,
      value: folder.name
    };
  });

  const response = await prompts({
    type: 'select',
    name: 'save',
    message: 'Select a save to load:',
    choices: choices
  });

  return response.save;
}

async function deleteFolderRecursive(folderPath) {
  try {
    await fs.rm(folderPath, { recursive: true, force: true });
  } catch (error) {
    console.error(`Error deleting folder ${folderPath}:`, error.message);
    throw error;
  }
}

async function copyFolderRecursive(source, destination) {
  try {
    await fs.cp(source, destination, { recursive: true });
  } catch (error) {
    console.error(`Error copying folder from ${source} to ${destination}:`, error.message);
    throw error;
  }
}

async function manageSaveFolder(selectedSave) {
  const defaultSavePath = path.join(PRIMORDIALIS_DIR, DEFAULT_SAVE_NAME);
  const selectedSavePath = path.join(PRIMORDIALIS_DIR, selectedSave);

  if (selectedSave !== DEFAULT_SAVE_NAME) {
    console.log(`Removing default save folder...`);
    await deleteFolderRecursive(defaultSavePath);

    console.log(`Copying "${selectedSave}" to "${DEFAULT_SAVE_NAME}"...`);
    await copyFolderRecursive(selectedSavePath, defaultSavePath);
    console.log('Save loaded successfully!');
  } else {
    console.log('Using default save folder.');
  }
}

async function isPrimordialisRunning() {
  return new Promise((resolve) => {
    const checkProcess = spawn('powershell.exe', [
      '-Command',
      'Get-Process -Name primordialis -ErrorAction SilentlyContinue | Select-Object -First 1'
    ]);

    let output = '';
    checkProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    checkProcess.on('close', () => {
      // If Get-Process finds the process, it outputs process info
      // If not found, output is empty
      const isRunning = output.trim().length > 0 && !output.includes('Cannot find');
      resolve(isRunning);
    });
  });
}

async function waitForGameToExit() {
  // Wait for the launcher process to exit and the actual game to start
  console.log('Waiting for game to start...');

  // Try to detect the game process for up to 30 seconds
  let gameDetected = false;
  for (let i = 0; i < 15; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000));

    if (await isPrimordialisRunning()) {
      gameDetected = true;
      console.log('Game detected! Monitoring...\n');
      break;
    }

    if (i < 14) {
      console.log(`Still waiting for game process... (${(i + 1) * 2}s)`);
    }
  }

  if (!gameDetected) {
    console.log('Warning: Game process not detected after 30 seconds. Continuing anyway...\n');
    return;
  }

  // Load initial world.run content for autosave comparison
  let lastWorldRunContent = await getWorldRunContent();
  let pollCount = 0;

  // Poll every 2 seconds until the game process exits
  while (await isPrimordialisRunning()) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    pollCount++;

    // Check for changes every 30 seconds (every 15 polls)
    if (pollCount % 15 === 0) {
      const currentWorldRunContent = await getWorldRunContent();

      if (currentWorldRunContent && lastWorldRunContent) {
        // Compare content
        if (!currentWorldRunContent.equals(lastWorldRunContent)) {
          console.log('Save file changed, creating autosave...');
          await createAutosave();
          lastWorldRunContent = currentWorldRunContent;
        }
      } else if (currentWorldRunContent && !lastWorldRunContent) {
        // world.run was created during gameplay
        console.log('Save file created, creating autosave...');
        await createAutosave();
        lastWorldRunContent = currentWorldRunContent;
      }
    }
  }

  console.log('Game process has exited.');
}

async function launchGame(exePath) {
  console.log(`\nLaunching Primordialis from: ${exePath}\n`);

  const gameDir = path.dirname(exePath);

  // Launch the game in detached mode
  const gameProcess = spawn(exePath, [], {
    stdio: 'ignore',
    detached: true,
    cwd: gameDir
  });

  gameProcess.unref();

  // Wait for the game to start and then exit
  await waitForGameToExit();
}

async function checkForWorldRun() {
  const worldRunPath = path.join(PRIMORDIALIS_DIR, DEFAULT_SAVE_NAME, 'world.run');
  try {
    await fs.access(worldRunPath);
    return true;
  } catch {
    return false;
  }
}

async function compareWorldRunFiles(originalSaveName) {
  const currentWorldRunPath = path.join(PRIMORDIALIS_DIR, DEFAULT_SAVE_NAME, 'world.run');
  const originalWorldRunPath = path.join(PRIMORDIALIS_DIR, originalSaveName, 'world.run');

  try {
    // Read both files as buffers for binary comparison
    const currentFile = await fs.readFile(currentWorldRunPath);
    const originalFile = await fs.readFile(originalWorldRunPath);

    // Compare file sizes first (quick check)
    if (currentFile.length !== originalFile.length) {
      return false; // Files are different
    }

    // Compare file contents
    return currentFile.equals(originalFile);
  } catch (error) {
    console.error('Error comparing world.run files:', error.message);
    // If we can't compare, assume they're different (safer to prompt)
    return false;
  }
}

async function getWorldRunContent() {
  const worldRunPath = path.join(PRIMORDIALIS_DIR, DEFAULT_SAVE_NAME, 'world.run');
  try {
    return await fs.readFile(worldRunPath);
  } catch (error) {
    return null;
  }
}

async function getOldestAutosaveSlot() {
  const autosaves = [];

  for (let i = 1; i <= 10; i++) {
    const autosaveName = `save - autosave ${i}`;
    const autosavePath = path.join(PRIMORDIALIS_DIR, autosaveName);

    try {
      const stats = await fs.stat(autosavePath);
      autosaves.push({ slot: i, name: autosaveName, mtime: stats.mtime });
    } catch {
      // Autosave doesn't exist, this is the slot to use
      return { slot: i, name: autosaveName };
    }
  }

  // All autosaves exist, find the oldest
  autosaves.sort((a, b) => a.mtime - b.mtime);
  return autosaves[0];
}

async function createAutosave() {
  const slot = await getOldestAutosaveSlot();
  const sourcePath = path.join(PRIMORDIALIS_DIR, DEFAULT_SAVE_NAME);
  const destPath = path.join(PRIMORDIALIS_DIR, slot.name);

  try {
    // Delete existing autosave if it exists
    await deleteFolderRecursive(destPath);

    // Create new autosave
    await copyFolderRecursive(sourcePath, destPath);
    console.log(`Autosave created: ${slot.name}`);
    return true;
  } catch (error) {
    console.error('Error creating autosave:', error.message);
    return false;
  }
}

async function saveCurrent() {
  const response = await prompts({
    type: 'text',
    name: 'saveName',
    message: 'Enter a name for this save (or leave empty to skip):',
    validate: value => {
      if (!value) return true;
      if (value.includes('/') || value.includes('\\')) {
        return 'Save name cannot contain / or \\';
      }
      return true;
    }
  });

  if (!response.saveName || response.saveName.trim() === '') {
    console.log('Save skipped.');
    return;
  }

  const saveName = response.saveName.trim();
  const newSaveName = `save - ${saveName}`;
  const sourcePath = path.join(PRIMORDIALIS_DIR, DEFAULT_SAVE_NAME);
  const destPath = path.join(PRIMORDIALIS_DIR, newSaveName);

  console.log(`Saving current game as "${newSaveName}"...`);
  await copyFolderRecursive(sourcePath, destPath);
  console.log('Save created successfully!\n');
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: node launcher.js <path-to-primordialis.exe>');
    process.exit(1);
  }

  const exePath = args[0];

  try {
    await fs.access(exePath);
  } catch {
    console.error(`Error: Game executable not found at: ${exePath}`);
    process.exit(1);
  }

  console.log(`Primordialis Launcher`);
  console.log(`Save directory: ${PRIMORDIALIS_DIR}\n`);

  while (true) {
    const saveFolders = await getSaveFolders();
    const selectedSave = await selectSave(saveFolders);

    if (!selectedSave) {
      console.log('No save selected. Exiting...');
      break;
    }

    await manageSaveFolder(selectedSave);
    await launchGame(exePath);

    const hasWorldRun = await checkForWorldRun();
    if (!hasWorldRun) {
      console.log('\nNo world.run file detected. Skipping save.\n');
    } else {
      // Compare current save with the original to see if it changed
      const filesAreIdentical = await compareWorldRunFiles(selectedSave);

      if (filesAreIdentical) {
        console.log('\nNo changes detected in save. Skipping save prompt.\n');
      } else {
        console.log('\nChanges detected in save.');
        await saveCurrent();
      }
    }
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
