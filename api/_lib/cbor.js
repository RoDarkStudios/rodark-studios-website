function readLength(buffer, offset, additionalInfo) {
    if (additionalInfo < 24) {
        return { value: additionalInfo, offset };
    }

    if (additionalInfo === 24) {
        if (offset + 1 > buffer.length) {
            throw new Error('Invalid CBOR payload');
        }
        return { value: buffer.readUInt8(offset), offset: offset + 1 };
    }

    if (additionalInfo === 25) {
        if (offset + 2 > buffer.length) {
            throw new Error('Invalid CBOR payload');
        }
        return { value: buffer.readUInt16BE(offset), offset: offset + 2 };
    }

    if (additionalInfo === 26) {
        if (offset + 4 > buffer.length) {
            throw new Error('Invalid CBOR payload');
        }
        return { value: buffer.readUInt32BE(offset), offset: offset + 4 };
    }

    if (additionalInfo === 27) {
        if (offset + 8 > buffer.length) {
            throw new Error('Invalid CBOR payload');
        }

        const high = buffer.readUInt32BE(offset);
        const low = buffer.readUInt32BE(offset + 4);
        const combined = high * 2 ** 32 + low;
        return { value: combined, offset: offset + 8 };
    }

    throw new Error('Unsupported CBOR additional info');
}

function decodeItem(buffer, initialOffset = 0) {
    if (!Buffer.isBuffer(buffer)) {
        throw new Error('CBOR decode expects a Buffer');
    }

    if (initialOffset >= buffer.length) {
        throw new Error('Invalid CBOR offset');
    }

    let offset = initialOffset;
    const first = buffer.readUInt8(offset);
    offset += 1;

    const majorType = first >> 5;
    const additionalInfo = first & 0x1f;

    if (majorType === 0) {
        const { value, offset: nextOffset } = readLength(buffer, offset, additionalInfo);
        return { value, offset: nextOffset };
    }

    if (majorType === 1) {
        const { value, offset: nextOffset } = readLength(buffer, offset, additionalInfo);
        return { value: -1 - value, offset: nextOffset };
    }

    if (majorType === 2) {
        const { value: length, offset: nextOffset } = readLength(buffer, offset, additionalInfo);
        const end = nextOffset + length;
        if (end > buffer.length) {
            throw new Error('Invalid CBOR byte string length');
        }
        return { value: buffer.slice(nextOffset, end), offset: end };
    }

    if (majorType === 3) {
        const { value: length, offset: nextOffset } = readLength(buffer, offset, additionalInfo);
        const end = nextOffset + length;
        if (end > buffer.length) {
            throw new Error('Invalid CBOR text length');
        }
        return { value: buffer.slice(nextOffset, end).toString('utf8'), offset: end };
    }

    if (majorType === 4) {
        const { value: length, offset: nextOffset } = readLength(buffer, offset, additionalInfo);
        let cursor = nextOffset;
        const result = [];

        for (let i = 0; i < length; i += 1) {
            const decoded = decodeItem(buffer, cursor);
            result.push(decoded.value);
            cursor = decoded.offset;
        }

        return { value: result, offset: cursor };
    }

    if (majorType === 5) {
        const { value: length, offset: nextOffset } = readLength(buffer, offset, additionalInfo);
        let cursor = nextOffset;
        const map = new Map();

        for (let i = 0; i < length; i += 1) {
            const keyResult = decodeItem(buffer, cursor);
            const valueResult = decodeItem(buffer, keyResult.offset);
            map.set(keyResult.value, valueResult.value);
            cursor = valueResult.offset;
        }

        return { value: map, offset: cursor };
    }

    if (majorType === 6) {
        const { offset: nextOffset } = readLength(buffer, offset, additionalInfo);
        return decodeItem(buffer, nextOffset);
    }

    if (majorType === 7) {
        if (additionalInfo === 20) {
            return { value: false, offset };
        }
        if (additionalInfo === 21) {
            return { value: true, offset };
        }
        if (additionalInfo === 22) {
            return { value: null, offset };
        }

        throw new Error('Unsupported CBOR simple value');
    }

    throw new Error('Unsupported CBOR major type');
}

function decodeFirst(buffer, offset = 0) {
    return decodeItem(buffer, offset);
}

module.exports = {
    decodeFirst
};
