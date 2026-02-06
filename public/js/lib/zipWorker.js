importScripts('./jszip.min.js')

let zip, folder
let frame = 0

// get data from main, process, and add to encoder
onmessage = function(e) {
    // if zip is initialized, add frame. otherwise, initialize
    if (zip) {
        addFrame(e.data.settings, e.data.pixels)
    } else {
        createZip(e.data.settings)
    }
}

function createZip(settings) {
    // console.log('creating zip')
    zip = new JSZip()
    folder = zip.folder('frames')
    frame = 1
    postMessage({ready: true})
}

function addFrame(settings, data) {
    let filename = frame.toString().padStart(3, '0') + '.png'
    folder.file(filename, data, {base64: true})

    // if this is the last frame, finalize the video
    if (frame >= settings.totalFrames) {
        postMessage({doneRecording: true})
        finalizeZip()
    }

    frame += 1
}

function finalizeZip() {
    zip.generateAsync({type: 'blob'}).then(function(content) {
        let url = URL.createObjectURL(content)
        postMessage({done: true, url})
        zip = undefined
    })
}