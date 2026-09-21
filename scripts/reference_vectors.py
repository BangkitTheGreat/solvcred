"""Independent SHA-256/Merkle reference. Never import the TypeScript implementation."""
import argparse
import hashlib
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / 'test-vectors' / 'v1.json'
ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'


def base58(data):
    number = int.from_bytes(data, 'big')
    text = ''
    while number:
        number, remainder = divmod(number, 58)
        text = ALPHABET[remainder] + text
    return '1' * (len(data) - len(data.lstrip(b'\0'))) + text


def pdf(index):
    stream = f'BT /F1 18 Tf 40 120 Td (SolVcred FICTIONAL fixture {index}) Tj ET'.encode('ascii')
    objects = [
        b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream',
    ]
    content = b'%PDF-1.4\n'
    offsets = [0]
    for i, body in enumerate(objects, 1):
        offsets.append(len(content))
        content += f'{i} 0 obj\n'.encode() + body + b'\nendobj\n'
    xref = len(content)
    content += f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode()
    for offset in offsets[1:]:
        content += f'{offset:010} 00000 n \n'.encode()
    content += f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    return content


def fixture(count):
    program = bytes([17]) * 32
    issuer = bytes([34]) * 32
    batch = bytes([count]) * 32
    context = {'network': 'solana-devnet', 'programId': base58(program),
               'issuerId': issuer.hex(), 'batchId': batch.hex()}
    documents = []
    leaves = []
    for index in range(count):
        document = pdf(index)
        nonce = bytes([index + 64]) * 32
        digest = hashlib.sha256(document).digest()
        preimage = b'\x00SolVcred\x01\x01' + program + issuer + batch + struct.pack('<II', count, index) + nonce + digest
        assert len(preimage) == 179
        leaf = hashlib.sha256(preimage).digest()
        leaves.append(leaf)
        documents.append({'pdfHex': document.hex(), 'documentHash': digest.hex(),
                          'leafPreimage': preimage.hex(), 'leafHash': leaf.hex(), 'nonce': nonce.hex()})
    levels = [leaves]
    while len(levels[-1]) > 1:
        previous = levels[-1]
        levels.append([hashlib.sha256(b'\x01' + previous[i] + (previous[i + 1] if i + 1 < len(previous) else previous[i])).digest()
                       for i in range(0, len(previous), 2)])
    commitment = {**context, 'leafCount': count, 'root': levels[-1][0].hex()}
    for index, item in enumerate(documents):
        siblings = []
        position = index
        for level in levels[:-1]:
            sibling = position ^ 1
            siblings.append(level[sibling if sibling < len(level) else position].hex())
            position //= 2
        item['proof'] = {**commitment, 'schemaVersion': 1, 'leafIndex': index,
                         'nonce': item.pop('nonce'), 'siblings': siblings}
    return {'commitment': commitment, 'documents': documents}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    vectors = {'description': 'Fictional test data. The program public key is NOT a deployed SolVcred program.',
               'cases': [fixture(count) for count in [1, 3, 5]]}
    if args.check:
        if json.loads(TARGET.read_text(encoding='utf-8')) != vectors:
            raise SystemExit('Fixture mismatch: reference and committed vectors differ')
        print('Independent Python reference: all v1 vectors match')
    else:
        TARGET.write_text(json.dumps(vectors, indent=2) + '\n', encoding='utf-8')
        print('Wrote test-vectors/v1.json')


if __name__ == '__main__':
    main()
