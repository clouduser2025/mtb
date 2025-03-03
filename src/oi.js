import React, { useState } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [strikePrice, setStrikePrice] = useState(48600);
  const [count, setCount] = useState(2);
  const [optionChain, setOptionChain] = useState([]);
  const [error, setError] = useState(null);

  const fetchOptionChain = async () => {
    try {
      const response = await axios.get('http://localhost:5000/option_chain', {
        params: { strikeprice: strikePrice, count: count }
      });
      if (response.data.error) {
        setError(response.data.error);
        setOptionChain([]);
      } else {
        setOptionChain(response.data);
        setError(null);
      }
    } catch (err) {
      setError('Failed to fetch option chain: ' + err.message);
      setOptionChain([]);
    }
  };

  return (
    <div className="App">
      <h1>Bank Nifty Option Chain</h1>
      <div>
        <label>
          Strike Price:
          <input
            type="number"
            value={strikePrice}
            onChange={(e) => setStrikePrice(Number(e.target.value))}
          />
        </label>
        <label>
          Count:
          <input
            type="number"
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </label>
        <button onClick={fetchOptionChain}>Fetch Option Chain</button>
      </div>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {optionChain.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Last Price</th>
              <th>Open Interest</th>
            </tr>
          </thead>
          <tbody>
            {optionChain.map((scrip, index) => (
              <tr key={index}>
                <td>{scrip.tsym}</td>
                <td>{scrip.lp}</td>
                <td>{scrip.oi}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default App;