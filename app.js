// --- DOM Elements ---
const pdfUpload = document.getElementById('pdf-upload');
const fileNameDisplay = document.getElementById('file-name');
const voiceSelect = document.getElementById('voice-select');
const speedControl = document.getElementById('speed-control');
const speedValue = document.getElementById('speed-value');
const chapterList = document.getElementById('chapters');
const currentChapterTitle = document.getElementById('current-chapter-title');
const textContent = document.getElementById('text-content');
const prevChapterButton = document.getElementById('prev-chapter-button');
const playPauseButton = document.getElementById('play-pause-button');
const nextChapterButton = document.getElementById('next-chapter-button');

// --- App State ---
let pdfDoc = null;
let chapters = [];
let currentChapterIndex = 0;
let isPlaying = false;
let speechUtterance = null;
let savedProgress = null;
let textChunks = [];
let currentChunkIndex = 0;

// --- Event Listeners ---
pdfUpload.addEventListener('change', handleFileUpload);

// --- Functions ---

function handleFileUpload(e) {
    stopAudio();
    const file = e.target.files[0];
    if (!file) return;

    fileNameDisplay.textContent = file.name;
    textContent.textContent = 'Processing file...';

    const reader = new FileReader();
    reader.onload = (event) => {
        const arrayBuffer = event.target.result;
        if (file.name.endsWith('.pdf')) {
            parsePdf(arrayBuffer);
        } else if (file.name.endsWith('.epub')) {
            parseEpub(arrayBuffer);
        } else {
            textContent.textContent = 'Unsupported file type. Please upload a PDF or EPUB.';
        }
    };
    reader.readAsArrayBuffer(file);
}

async function parseEpub(arrayBuffer) {
    try {
        const book = ePub(arrayBuffer);
        const nav = await book.loaded.navigation;
        
        chapters = await Promise.all(nav.toc.map(async (tocItem) => {
            const section = book.section(tocItem.href);
            const loaded = await section.load();
            
            // Create a temporary div to extract text from the HTML content
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = loaded.innerHTML;
            const content = tempDiv.textContent || tempDiv.innerText || '';
            
            return {
                title: tocItem.label.trim(),
                content: content.trim()
            };
        }));

        displayChapters();
        
        if (savedProgress && savedProgress.pdfName === fileNameDisplay.textContent) {
            loadChapter(savedProgress.chapterIndex);
            savedProgress = null; // Reset after loading
        } else {
            loadChapter(0);
        }
    } catch (error) {
        console.error('Error parsing EPUB:', error);
        textContent.textContent = 'Error parsing EPUB file. It might be corrupted or protected.';
    }
}

async function parsePdf(data) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js';
    const loadingTask = pdfjsLib.getDocument({ data });
    try {
        pdfDoc = await loadingTask.promise;
        let allText = '';
        for (let i = 1; i <= pdfDoc.numPages; i++) {
            const page = await pdfDoc.getPage(i);
            const content = await page.getTextContent();
            allText += content.items.map(item => item.str).join(' ') + '\n\n';
        }
        extractChapters(allText);
    } catch (error) {
        console.error('Error parsing PDF:', error);
        textContent.textContent = 'Error parsing PDF.';
    }
}

function extractChapters(text) {
    const chapterRegex = /(Chapter\s+\d+)/gi;
    const splitText = text.split(chapterRegex);
    chapters = [];
    if (splitText.length > 1) {
        for (let i = 1; i < splitText.length; i += 2) {
            chapters.push({ title: splitText[i], content: splitText[i + 1]?.trim() || '' });
        }
    } else {
        chapters.push({ title: "Full Text", content: text.trim() });
    }
    displayChapters();
    if (savedProgress && savedProgress.pdfName === fileNameDisplay.textContent) {
        loadChapter(savedProgress.chapterIndex);
        savedProgress = null;
    } else {
        loadChapter(0);
    }
}

function displayChapters() {
    chapterList.innerHTML = '';
    chapters.forEach((chapter, index) => {
        const li = document.createElement('li');
        li.textContent = chapter.title;
        li.dataset.index = index;
        chapterList.appendChild(li);
    });
}

function loadChapter(index) {
    stopAudio();
    if (index >= 0 && index < chapters.length) {
        currentChapterIndex = index;
        const chapter = chapters[index];
        currentChapterTitle.textContent = chapter.title;
        textContent.textContent = chapter.content;
        Array.from(chapterList.children).forEach((li, i) => li.classList.toggle('active', i === index));
        saveProgress();
    }
}

function saveProgress() {
    localStorage.setItem('audiobook_sparkle_progress', JSON.stringify({
        pdfName: fileNameDisplay.textContent,
        chapterIndex: currentChapterIndex
    }));
}

function handleSpeedChange() {
    if(speedValue) speedValue.textContent = `${speedControl.value}x`;
    if (isPlaying) {
        stopAudio();
        getSpeech();
    }
}

function handlePlayPause() {
    if (isPlaying) {
        speechSynthesis.pause();
        isPlaying = false;
        playPauseButton.textContent = '▶️ Play';
    } else {
        if (speechSynthesis.paused) {
            speechSynthesis.resume();
            isPlaying = true;
            playPauseButton.textContent = '⏸️ Pause';
        } else {
            getSpeech();
        }
    }
}

function stopAudio() {
    speechSynthesis.cancel();
    isPlaying = false;
    currentChunkIndex = 0;
    textChunks = [];
    playPauseButton.textContent = '▶️ Play';
}

function getSpeech() {
    if (chapters.length === 0) return alert('Please upload a PDF first.');
    const text = chapters[currentChapterIndex].content;
    // Split text into smaller chunks to avoid issues with long texts
    textChunks = text.match(/[^.!?]+[.!?]+|\S+/g) || [];
    currentChunkIndex = 0;
    
    playSpeechChunk();
}

function playSpeechChunk() {
    if (currentChunkIndex >= textChunks.length) {
        stopAudio();
        return;
    }

    const chunk = textChunks[currentChunkIndex];
    speechUtterance = new SpeechSynthesisUtterance(chunk);
    
    const selectedVoiceName = voiceSelect.selectedOptions[0]?.getAttribute('data-name');
    const voices = speechSynthesis.getVoices();
    speechUtterance.voice = voices.find(voice => voice.name === selectedVoiceName) || voices[0];
    speechUtterance.rate = parseFloat(speedControl.value);

    speechUtterance.onstart = () => {
        isPlaying = true;
        playPauseButton.textContent = '⏸️ Pause';
    };

    speechUtterance.onend = () => {
        currentChunkIndex++;
        if (speechSynthesis.speaking) { // If it was cancelled, don't continue
            playSpeechChunk();
        }
    };
    
    speechUtterance.onerror = (event) => {
        console.error('Speech synthesis error:', event.error);
        stopAudio();
    };

    speechSynthesis.speak(speechUtterance);
}


function handlePrevChapter() {
    if (currentChapterIndex > 0) loadChapter(currentChapterIndex - 1);
}

function handleNextChapter() {
    if (currentChapterIndex < chapters.length - 1) loadChapter(currentChapterIndex + 1);
}

function handleChapterSelection(e) {
    if (e.target && e.target.matches('li')) {
        loadChapter(parseInt(e.target.dataset.index, 10));
    }
}

function populateVoiceList() {
    const voices = speechSynthesis.getVoices();
    voiceSelect.innerHTML = '';
    voices.forEach(voice => {
        const option = document.createElement('option');
        option.textContent = `${voice.name} (${voice.lang})`;
        option.setAttribute('data-name', voice.name);
        voiceSelect.appendChild(option);
    });
}

function loadProgress() {
    const progressString = localStorage.getItem('audiobook_sparkle_progress');
    if (progressString) {
        savedProgress = JSON.parse(progressString);
        textContent.innerHTML = `<p>Welcome back! You were reading <strong>${savedProgress.pdfName}</strong>.</p><p>Please upload it again to resume where you left off.</p>`;
    }
}

// --- Initial Setup ---
window.addEventListener('DOMContentLoaded', () => {
    loadProgress();
    // Voices load asynchronously
    if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = populateVoiceList;
    }
    populateVoiceList();
    handleSpeedChange();
});