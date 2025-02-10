import React, { useState, useEffect, useRef } from 'react';
import { Container, Button, Table, Form, Alert, Modal, Row, Col } from 'react-bootstrap';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faUserPlus, 
  faUsers, 
  faSignInAlt, 
  faShoppingCart, 
  faExchangeAlt 
} from '@fortawesome/free-solid-svg-icons';
import './css/landing.css';

const Landing = () => {
  /********************************************************
   *           ORIGINAL STATES & REGISTRATION             *
   ********************************************************/
  const [users, setUsers] = useState([]);
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [message, setMessage] = useState({ text: "", type: "" });

  const [formData, setFormData] = useState({
    username: "",
    broker: "Angel",
    api_key: "",
    totp_token: "",
    default_quantity: "",
  });
  const [showLtpForm, setShowLtpForm] = useState(false); // Controls LTP Form visibility

  // Original: Buy or Sell? 
  const [actionType, setActionType] = useState(null);
  // Show/hide the combined threshold + stop-loss form
  const [showStopLossForm, setShowStopLossForm] = useState(false);

  /********************************************************
   *          NEW: PRICE SIMULATION + THRESHOLDS          *
   ********************************************************/
  const [currentPrice, setCurrentPrice] = useState(90); // Starting point for simulation
  const [isSimulating, setIsSimulating] = useState(false);
  const simulationRef = useRef(null);

  // For "Buy" threshold => buy if price >= this
  const [buyThreshold, setBuyThreshold] = useState(100);

  // For "Sell" threshold => short if price <= this
  // Use `&#8804;` in the label so JSX doesn't parse "≤" incorrectly.
  const [sellThreshold, setSellThreshold] = useState(120);

  // Once we actually buy or short, store that entry price
  const [entryPrice, setEntryPrice] = useState(null);

  // STOP-LOSS form fields
  const [stopLossType, setStopLossType] = useState('fixed'); // 'fixed', 'percentage', 'points'
  const [stopLossValue, setStopLossValue] = useState(95);    // numeric
  // Add these new state variable declarations here
  const [buyConditionType, setBuyConditionType] = useState('fixed'); // Initializes the condition type for buying
  const [buyConditionValue, setBuyConditionValue] = useState(0); // Initializes the condition value for buying
  const [pointsCondition, setPointsCondition] = useState(0); // relevant for trailing scenarios

  // For trailing, we track a "base" price
  const basePriceRef = useRef(null);
  
const [exchange, setExchange] = useState("NSE"); // Default to NSE
const [ltpSymbol, setLtpSymbol] = useState(""); // Stock Symbol
const [symbolToken, setSymbolToken] = useState(""); // Optional Token
const [ltpPrice, setLtpPrice] = useState(null); // LTP Value
const [loadingLtp, setLoadingLtp] = useState(false); // Loading Indicator

const fetchLtp = async () => {
  if (!ltpSymbol) {
    alert("Please enter a stock symbol.");
    return;
  }

  setLoadingLtp(true); // Start loading indicator

  try {
    const response = await fetch(`http://127.0.0.1:8001/api/fetch_ltp?exchange=${exchange}&symbol=${ltpSymbol}&token=${symbolToken}`);
    const data = await response.json();

    if (response.status) {
      setLtpPrice(data.ltp);
    } else {
      setLtpPrice(null);
      alert("Failed to fetch LTP. Please check the symbol.");
    }
  } catch (error) {
    console.error("Error fetching LTP:", error);
    alert("Server error. Try again later.");
  } finally {
    setLoadingLtp(false); // Stop loading indicator
  }
};



  /********************************************************
   *          FETCH REGISTERED USERS (ORIGINAL)           *
   ********************************************************/
    useEffect(() => {
      if (!isSimulating) return;
    
      // Check buy conditions
      if (actionType === 'buy' && entryPrice === null) {
        let conditionMet = false;
        switch (buyConditionType) {
          case 'fixed':
            conditionMet = currentPrice >= buyConditionValue;
            break;
          case 'percentage':
            conditionMet = currentPrice >= currentPrice * (1 + buyConditionValue / 100);
            break;
          case 'points':
            conditionMet = currentPrice >= currentPrice + buyConditionValue;
            break;
          default:
            conditionMet = false;
        }
    
        if (conditionMet) {
          console.log(`** BUY triggered at ${currentPrice} based on condition **`);
          setEntryPrice(currentPrice);
          basePriceRef.current = currentPrice;
        }
      }
    // Existing sell logic...
  }, [currentPrice, isSimulating, entryPrice, actionType, buyThreshold, sellThreshold, buyConditionType, buyConditionValue]);

  
  useEffect(() => {
    const fetchUsers = async () => {
        try {
            const response = await fetch('/api/get_users');  // New API call
            const data = await response.json();
            setUsers(data);
        } catch (error) {
            console.error("Error fetching users:", error);
        }
    };
    fetchUsers();
}, []);


// ✅ Define `executeBuyTrade` to Send Trade Request to Backend
const executeBuyTrade = async (price) => {
  if (selectedUsers.length === 0) {
      console.log("No users selected for trade.");
      return;
  }

  const buyData = {
      users: selectedUsers,
      symbol: formData.symbol,
      buy_price: price,
      buy_condition_type: buyConditionType,
      buy_condition_value: buyConditionValue,
      stop_loss_type: stopLossType,
      stop_loss_value: stopLossValue,
      points_condition: pointsCondition
  };

  try {
      const response = await fetch('/api/buy_trade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buyData),
      });

      const data = await response.json();
      if (response.ok) {
          console.log(`✅ Trade executed at ${price}:`, data);
          setEntryPrice(price);
          basePriceRef.current = price;
      } else {
          console.error("❌ Trade execution failed:", data.error);
      }
  } catch (error) {
      console.error("❌ API Error executing trade:", error);
  }
};

  /********************************************************
   *        ORIGINAL: REGISTER USER SUBMIT HANDLER        *
   ********************************************************/
  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    console.log("Submitting form data:", formData); // ✅ Debugging

    try {
      const response = await fetch('http://127.0.0.1:8000/api/register_user', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await response.json();
      console.log("API Response:", data);  // ✅ Debugging

      if (response.ok) {
        setMessage({ text: 'User registered successfully!', type: 'success' });
        setUsers([...users, formData]);  // ✅ Update users list
        setFormData({ username: "", broker: "Angel", api_key: "", totp_token: "", default_quantity: "" });
      } else {
        setMessage({ text: data.message || 'Registration failed', type: 'danger' });
      }
    } catch (error) {
      console.error("Error registering user:", error);
      setMessage({ text: 'Server error. Try again later.', type: 'danger' });
    }
};


  /********************************************************
   *          ORIGINAL BUY/SELL BUTTON CLICK HANDLERS     *
   ********************************************************/
  const handleBuyClick = () => {
    setActionType('buy');
    setShowStopLossForm(true);
  };

  const handleSellClick = () => {
    setActionType('sell');
    setShowStopLossForm(true);
  };

  /********************************************************
   *           PRICE SIMULATION (start/stop)              *
   ********************************************************/
  const startSimulation = () => {
    if (!isSimulating) {
      setIsSimulating(true);
      simulationRef.current = setInterval(() => {
        // Randomly move price by -2..+4
        const change = Math.floor(Math.random() * 7) - 2;
        setCurrentPrice((prev) => Math.max(1, prev + change));
      }, 1000);
    }
  };

  const stopSimulation = () => {
    setIsSimulating(false);
    if (simulationRef.current) {
      clearInterval(simulationRef.current);
      simulationRef.current = null;
    }
  };

  /********************************************************
   *   WATCH CURRENT PRICE => CHECK BUY/SELL THRESHOLDS   *
   ********************************************************/
// ✅ Fetch Users from Backend
useEffect(() => {
  const fetchUsers = async () => {
      try {
          const response = await fetch('/api/get_users');  // New API call
          const data = await response.json();
          setUsers(data);
      } catch (error) {
          console.error("Error fetching users:", error);
      }
  };
  fetchUsers();
}, []);

// ✅ Buy Condition Execution
useEffect(() => {
  if (!isSimulating) return;

  if (actionType === 'buy' && entryPrice === null) {
      let conditionMet = false;
      
      switch (buyConditionType) {
          case 'fixed':
              conditionMet = currentPrice >= buyConditionValue;
              break;
          case 'percentage':
              conditionMet = currentPrice >= (buyThreshold * (1 + buyConditionValue / 100)); 
              break;
          case 'points':
              conditionMet = currentPrice >= (buyThreshold + buyConditionValue);
              break;
          default:
              conditionMet = false;
      }

      if (conditionMet) {
          console.log(`** BUY triggered at ${currentPrice} based on ${buyConditionType} condition **`);
          executeBuyTrade(currentPrice);
      }
  }
}, [currentPrice, isSimulating, entryPrice, actionType, buyThreshold, buyConditionType, buyConditionValue]);

  /********************************************************
   *        STOP-LOSS SCENARIOS (BUY => SELL)             *
   ********************************************************/
  const simulateStopLossForBuy = (price) => {
    const entry = entryPrice;
    const base = basePriceRef.current;

    switch (true) {
      /**
       * Scenario 1: Fixed
       * e.g. if price <= stopLossValue => SELL
       */
      case stopLossType === 'fixed':
        if (price <= stopLossValue) {
          console.log(`Scenario 1: Price ${price} <= ${stopLossValue}, SELL triggered!`);
          finalizeTrade(price, 'sell');
        }
        break;

      /**
       * Scenario 2: Trailing % (pointsCondition=0 => no negative dips)
       * e.g. 50 => lock 50% if price above entry
       */
      case (stopLossType === 'percentage' && pointsCondition === 0):
        if (price > base) {
          const newStop = entry + (price - entry) * (stopLossValue / 100);
          console.log(`Scenario 2: Price=${price}, trailingStop=${newStop}`);
          if (price <= newStop) {
            console.log(`Scenario 2: Price ${price} <= stop ${newStop}, SELL triggered!`);
            finalizeTrade(price, 'sell');
          }
        }
        break;

      /**
       * Scenario 3: Trailing % with Negative Points Condition
       * e.g. if price dips 2 below base => update base
       */
      case (stopLossType === 'percentage' && pointsCondition < 0):
        if (price <= base + pointsCondition) {
          basePriceRef.current = price;
          console.log(`Scenario 3: Base updated => ${price}`);
        }
        if (price > basePriceRef.current) {
          const newStop =
            basePriceRef.current + 
            (price - basePriceRef.current) * (stopLossValue / 100);
          console.log(`Scenario 3: Price=${price}, trailingStop=${newStop}`);
          if (price <= newStop) {
            console.log(`Scenario 3: SELL triggered at ${price}!`);
            finalizeTrade(price, 'sell');
          }
        }
        break;

      /**
       * Scenario 4: Trailing with Points
       */
      case (stopLossType === 'points'):
        if (price > base) {
          const newStop = price - stopLossValue;
          console.log(`Scenario 4: Price=${price}, trailingStop=${newStop}`);
          if (price <= newStop) {
            console.log(`Scenario 4: SELL triggered at price=${price}`);
            finalizeTrade(price, 'sell');
          }
        }
        break;

      /**
       * Scenario 5: Combined Logic (Percentage + small dips)
       */
      default:
        if (stopLossType === 'percentage' && pointsCondition < 0) {
          if (price <= base + pointsCondition) {
            basePriceRef.current = price;
            console.log(`Scenario 5: Base updated => ${price}`);
          }
          if (price > basePriceRef.current) {
            const newStop =
              basePriceRef.current +
              (price - basePriceRef.current) * (stopLossValue / 100);
            console.log(`Scenario 5: Price=${price}, trailingStop=${newStop}`);
            if (price <= newStop) {
              console.log(`Scenario 5: SELL triggered at ${price}!`);
              finalizeTrade(price, 'sell');
            }
          }
        }
        break;
    }
  };

  /********************************************************
   *        STOP-LOSS SCENARIOS (SELL => BUY)             *
   ********************************************************/
  const simulateStopLossForSell = (price) => {
    const entry = entryPrice;
    const base = basePriceRef.current;

    switch (true) {
      /**
       * Scenario 1: Fixed (Short)
       * e.g. short=120, stopLossValue=125 => if price>=125 => buy
       */
      case stopLossType === 'fixed':
        if (price >= stopLossValue) {
          console.log(`(Short) Scenario 1: Price ${price} >= ${stopLossValue}, BUY triggered!`);
          finalizeTrade(price, 'buy');
        }
        break;

      /**
       * Scenario 2: Trailing % (Short), pointsCondition=0
       * e.g. short=120 => price=110 => profit=10 => lock 50% => stop=115 => if price≥115 => buy
       */
      case (stopLossType === 'percentage' && pointsCondition === 0):
        if (price < base) {
          const profit = base - price;
          const newStop = entry - (profit * (stopLossValue / 100));
          console.log(`(Short) Scenario 2: Price=${price}, trailingStop=${newStop}`);
          if (price >= newStop) {
            console.log(`(Short) Scenario 2: Price ${price} >= stop ${newStop}, BUY triggered!`);
            finalizeTrade(price, 'buy');
          }
        }
        break;

      /**
       * Scenario 3: Negative Points Condition (Short)
       */
      case (stopLossType === 'percentage' && pointsCondition < 0):
        if (price >= base - pointsCondition) {
          basePriceRef.current = price;
          console.log(`(Short) Scenario 3: Base updated => ${price}`);
        }
        if (price < basePriceRef.current) {
          const profit = basePriceRef.current - price;
          const newStop = basePriceRef.current - (profit * (stopLossValue / 100));
          console.log(`(Short) Scenario 3: Price=${price}, trailingStop=${newStop}`);
          if (price >= newStop) {
            console.log(`(Short) Scenario 3: BUY triggered at ${price}`);
            finalizeTrade(price, 'buy');
          }
        }
        break;

      /**
       * Scenario 4: Points (Short)
       */
      case (stopLossType === 'points'):
        if (price < base) {
          const newStop = price + stopLossValue;
          console.log(`(Short) Scenario 4: Price=${price}, trailingStop=${newStop}`);
          if (price >= newStop) {
            console.log(`(Short) Scenario 4: BUY triggered at ${price}`);
            finalizeTrade(price, 'buy');
          }
        }
        break;

      /**
       * Scenario 5: Combined (Short)
       */
      default:
        if (stopLossType === 'percentage' && pointsCondition < 0) {
          if (price >= base - pointsCondition) {
            basePriceRef.current = price;
            console.log(`(Short) Scenario 5: Base updated => ${price}`);
          }
          if (price < basePriceRef.current) {
            const profit = basePriceRef.current - price;
            const newStop = basePriceRef.current - (profit * (stopLossValue / 100));
            console.log(`(Short) Scenario 5: Price=${price}, trailingStop=${newStop}`);
            if (price >= newStop) {
              console.log(`(Short) Scenario 5: BUY triggered at ${price}`);
              finalizeTrade(price, 'buy');
            }
          }
        }
        break;
    }
  };

  /********************************************************
   *        FINALIZE TRADE => EXIT + STOP SIMULATION      *
   ********************************************************/
  const finalizeTrade = (exitPrice, exitAction) => {
    console.log(`Exiting position with a ${exitAction.toUpperCase()} at price=${exitPrice}`);
    setEntryPrice(null); // no open position
    stopSimulation(); 
  };

  /********************************************************
   *   WHEN USER SUBMITS THE "BUY/SELL + STOP-LOSS" FORM  *
   ********************************************************/
  const handleStopLossSubmission = async (e) => {
    e.preventDefault();

    const buyData = {
        users: selectedUsers,  // Sends selected users to backend
        symbol: formData.symbol,
        buy_threshold: buyThreshold,
        buy_condition_type: buyConditionType,
        buy_condition_value: buyConditionValue,
        stop_loss_type: stopLossType,
        stop_loss_value: stopLossValue,
        points_condition: pointsCondition
    };

    try {
        const response = await fetch('/api/buy_trade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buyData),
        });

        const data = await response.json();
        if (response.ok) {
            console.log("Trade executed successfully:", data);
            setMessage({ text: 'Trade executed successfully!', type: 'success' });
        } else {
            setMessage({ text: data.error || 'Trade execution failed', type: 'danger' });
        }
    } catch (error) {
        console.error("Error executing trade:", error);
        setMessage({ text: 'Server error. Try again later.', type: 'danger' });
    }
};

const handleDeleteUser = async (username) => {
  console.log(`Deleting user: ${username}`); // ✅ Debugging log

  try {
      const response = await fetch(`http://127.0.0.1:8000/api/delete_user/${username}`, {
          method: 'DELETE',
      });

      const data = await response.json();
      console.log("API Response:", data);  // ✅ Debugging log

      if (response.ok) {
          setUsers(users.filter(user => user.username !== username));  // ✅ Update UI
          setMessage({ text: 'User deleted successfully!', type: 'success' });
      } else {
          setMessage({ text: data.detail || 'Failed to delete user', type: 'danger' });
      }
  } catch (error) {
      console.error("❌ Error deleting user:", error);
      setMessage({ text: 'Server error. Try again later.', type: 'danger' });
  }
};

  /********************************************************
   *                     RENDER (JSX)                     *
   ********************************************************/
  return (
    <>
      <Container className="mt-4">
      {/* Original: Register, ViewUsers, Angel Login (Updated Colors) */}
      {/* Move Register, View Users, and Angel Login to the Top-Right, 20% Down */}
      <Row className="justify-content-end mb-3" 
        style={{ position: "absolute", top: "9%", right: "10px", zIndex: "1000" }}>
        <Col xs="auto">
        <Button 
          onClick={() => setShowRegisterModal(true)} 
          className="gradient-button btn-register"
        >
          <FontAwesomeIcon icon={faUserPlus} /> Register
        </Button>

        </Col>


        <Col xs="auto">
        <Button 
          onClick={() => setShowUsers(!showUsers)} 
          className="gradient-button btn-users"
        >
          <FontAwesomeIcon icon={faUsers} /> View Users
        </Button>

        </Col>
        <Col xs="auto">
        <Button
          onClick={() => window.open('https://www.angelone.in/login/?redirectUrl=account', '_blank')}
          className="gradient-button btn-login"
        >
          <FontAwesomeIcon icon={faSignInAlt} /> Angel Login
        </Button>

        </Col>
      </Row>



        {/* Original: Users Table */}
        {showUsers && (
          <Container>
            <h3 className="text-center">Registered Users</h3>
            <Table striped bordered hover>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Broker</th>
                  <th>Default Quantity</th>
                </tr>
              </thead>
              <tbody>
              {users.map((user, index) => (
                  <tr key={index}>
                      <td>{user.username}</td>
                      <td>{user.broker}</td>
                      <td>{user.default_quantity}</td>
                      <td>
                          <Button variant="danger" size="sm" onClick={() => handleDeleteUser(user.username)}>
                              Delete
                          </Button>
                      </td>
                  </tr>
              ))}
          </tbody>

            </Table>
          </Container>
        )}
        
        {/* Updated: AngelOne Trading Buttons (Refined Colors) */}
      {/* Updated: AngelOne Trading Buttons (Gradient Styling) */}
      <Row className="justify-content-center mb-3">
        <Col xs="auto">
          <Button
            onClick={() => window.open('https://www.angelone.in/trade/markets/equity/overview', '_blank')}
            className="gradient-button btn-market"
          >
            Market Overview
          </Button>
        </Col>

        <Col xs="auto">
          <Button
            onClick={() => window.open('https://www.angelone.in/trade/indices/indian', '_blank')}
            className="gradient-button btn-indices"
          >
            Indices
          </Button>
        </Col>

        <Col xs="auto">
          <Button
            onClick={() => window.open('https://www.angelone.in/trade/watchlist/chart', '_blank')}
            className="gradient-button btn-chart"
          >
            Chart
          </Button>
        </Col>

        <Col xs="auto">
          <Button
            onClick={() => window.open('https://www.angelone.in/trade/watchlist/option-chain', '_blank')}
            className="gradient-button btn-option"
          >
            Option Chain
          </Button>
        </Col>

        <Col xs="auto">
          <Button
            onClick={() => setShowLtpForm(!showLtpForm)}
            className="gradient-button btn-ltp"
          >
            Fetch LTP
          </Button>
        </Col>
      </Row>


        {/* Show LTP Form when button is clicked */}
        {showLtpForm && (
          <Container className="mt-4 p-3 border rounded shadow-sm">
            <h4 className="text-primary">🔍 Live Fetch LTP</h4>
            <Form onSubmit={(e) => { e.preventDefault(); fetchLtp(); }}>
              <Row className="mb-3">
                {/* Select Exchange (Dropdown) */}
                <Col md={3}>
                  <Form.Group controlId="exchange">
                    <Form.Label>Select Exchange</Form.Label>
                    <Form.Select
                      value={exchange}
                      onChange={(e) => setExchange(e.target.value)}
                    >
                      <option value="NSE">NSE</option>
                      <option value="BSE">BSE</option>
                    </Form.Select>
                  </Form.Group>
                </Col>

                {/* Input for Stock Symbol */}
                <Col md={3}>
                  <Form.Group controlId="ltpSymbol">
                    <Form.Label>Enter Stock Symbol</Form.Label>
                    <Form.Control
                      type="text"
                      placeholder="e.g. RELIANCE"
                      value={ltpSymbol}
                      onChange={(e) => setLtpSymbol(e.target.value)}
                      required
                    />
                  </Form.Group>
                </Col>

                {/* Input for Symbol Token (Optional) */}
                <Col md={3}>
                  <Form.Group controlId="symbolToken">
                    <Form.Label>Enter Symbol Token (Optional)</Form.Label>
                    <Form.Control
                      type="text"
                      placeholder="e.g. 3045"
                      value={symbolToken}
                      onChange={(e) => setSymbolToken(e.target.value)}
                    />
                  </Form.Group>
                </Col>

                {/* Fetch LTP Button */}
                <Col md={2}>
                  <Button type="submit" variant="primary" className="mt-4">
                    Fetch LTP
                  </Button>
                </Col>
              </Row>
            </Form>


            {loadingLtp && <p>Loading...</p>}

            {ltpPrice !== null && (
              <Alert variant="success">
                📈 Latest Price of <strong>{ltpSymbol}</strong>: ₹{ltpPrice}
              </Alert>
            )}
          </Container>
        )}

        {/* Updated: Buy / Sell Buttons with Trading Candle Colors */}
        <Row className="justify-content-center mb-3">
          <Col xs="auto">
          <Button 
              onClick={handleBuyClick} 
              className="gradient-button btn-buy"
            >
              <FontAwesomeIcon icon={faShoppingCart} /> Buy
            </Button>

          </Col>
          <Col xs="auto">
          <Button 
            onClick={handleSellClick} 
            className="gradient-button btn-sell"
          >
            <FontAwesomeIcon icon={faExchangeAlt} /> Sell
          </Button>

          </Col>
          <Col xs="auto">
          <Button onClick={stopSimulation} className="gradient-button btn-stop">
          Stop Simulation
        </Button>

          </Col>
        </Row>

        {/* The Big Form: for Buy or Sell thresholds + Stop-Loss */}
        {showStopLossForm && (
          <Container className="mt-4 p-3 border rounded shadow-sm">
            <h4 className={actionType === 'buy' ? "text-success" : "text-danger"}>
              {actionType === 'buy' ? (
                <>
                  <FontAwesomeIcon icon={faShoppingCart} /> Buy with Stop-Loss
                </>
              ) : (
                <>
                  <FontAwesomeIcon icon={faExchangeAlt} /> Sell with Stop-Loss
                </>
              )}
            </h4>
            <Form onSubmit={handleStopLossSubmission}>
              <Row className="mb-3">
                {/* If user clicks Buy => show Buy Threshold */}
                {actionType === 'buy' && (
                  <>
                    <Col md={3}>
                      <Form.Group controlId="buyThreshold">
                        <Form.Label>Buy Threshold (&#8805;)</Form.Label>
                        <Form.Control
                          type="number"
                          value={buyThreshold}
                          onChange={(e) => setBuyThreshold(Number(e.target.value))}
                        />
                      </Form.Group>
                    </Col>
                    <Col md={3}>
                    <Form.Group controlId="buyConditionType">
                      <Form.Label>Buy Strategy</Form.Label>
                      <Form.Select
                        value={buyConditionType}
                        onChange={(e) => setBuyConditionType(e.target.value)}
                      >
                        <option value="Fixed">Fixed Value</option>
                        <option value="Percentage">Percentage from Market</option>
                        <option value="RSI">RSI-Based Buy</option>
                        <option value="MovingAverage">Moving Average Buy</option>
                        <option value="Support">Support Level Buy</option>
                      </Form.Select>
                    </Form.Group>

                    </Col>
                    <Col md={3}>
                      <Form.Group controlId="buyConditionValue">
                        <Form.Label>Buy Condition Value</Form.Label>
                        <Form.Control
                          type="number"
                          value={buyConditionValue}
                          onChange={(e) => setBuyConditionValue(Number(e.target.value))}
                        />
                      </Form.Group>
                    </Col>
                  </>
                )}


                {/* If user clicks Sell => show Sell Threshold */}
                {actionType === 'sell' && (
                  <Col md={3}>
                    <Form.Group controlId="sellThreshold">
                      <Form.Label>Sell Threshold (&#8804;)</Form.Label>
                      <Form.Control
                        type="number"
                        value={sellThreshold}
                        onChange={(e) => setSellThreshold(Number(e.target.value))}
                      />
                    </Form.Group>
                  </Col>
                )}

                <Row className="mb-3">
                  {/* NEW: Select User ID */}
                  <Col md={3}>
                    <Form.Group controlId="selectUserID">
                      <Form.Label>Select User ID</Form.Label>
                      <Form.Select
                        multiple
                        value={selectedUsers}
                        onChange={(e) => {
                          const selectedOptions = [...e.target.options]
                            .filter(option => option.selected)
                            .map(option => option.value);
                          setSelectedUsers(selectedOptions);
                        }}
                      >
                        {users.map((user, index) => (
                          <option key={index} value={user.username}>
                            {user.username}
                          </option>
                        ))}
                      </Form.Select>
                    </Form.Group>
                  </Col>

                  {/* NEW: Symbol Input Field */}
                  <Col md={3}>
                    <Form.Group controlId="symbol">
                      <Form.Label>Symbol</Form.Label>
                      <Form.Control
                        type="text"
                        placeholder="Enter Stock Symbol"
                        value={formData.symbol}
                        onChange={(e) =>
                          setFormData({ ...formData, symbol: e.target.value })
                        }
                      />
                    </Form.Group>
                  </Col>
                </Row>

                {/* Stop-Loss Type (Existing Code) */}
                <Col md={3}>
                  <Form.Group controlId="stopLossType">
                    <Form.Label>Stop-Loss Type</Form.Label>
                    <Form.Select
                      value={stopLossType}
                      onChange={(e) => setStopLossType(e.target.value)}
                    >
                      <option value="fixed">Fixed</option>
                      <option value="percentage">Percentage</option>
                      <option value="points">Points</option>
                    </Form.Select>
                  </Form.Group>
                </Col>

                {/* Stop-Loss Value */}
                <Col md={3}>
                  <Form.Group controlId="stopLossValue">
                    <Form.Label>Stop-Loss Value</Form.Label>
                    <Form.Control
                      type="number"
                      value={stopLossValue}
                      onChange={(e) => setStopLossValue(Number(e.target.value))}
                    />
                  </Form.Group>
                </Col>

                {/* Points Condition (for trailing dips, e.g. -2) */}
                <Col md={3}>
                  <Form.Group controlId="pointsCondition">
                    <Form.Label>Points Condition</Form.Label>
                    <Form.Control
                      type="number"
                      value={pointsCondition}
                      onChange={(e) => setPointsCondition(Number(e.target.value))}
                    />
                  </Form.Group>
                </Col>
              </Row>

              <Row className="mb-3">
                <Col>
                  <Form.Label>Select Users</Form.Label>
                  {users.map((user, index) => (
                    <Form.Check
                      key={index}
                      type="checkbox"
                      label={user.username}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedUsers([...selectedUsers, user.username]);
                        } else {
                          setSelectedUsers(
                            selectedUsers.filter(u => u !== user.username)
                          );
                        }
                      }}
                    />
                  ))}
                </Col>
              </Row>

              <Button type="submit" variant="primary">
                {actionType === 'buy'
                  ? 'Confirm Buy + Stop-Loss'
                  : 'Confirm Sell + Stop-Loss'}
              </Button>
            </Form>
          </Container>
        )}


      </Container>

      {/* ORIGINAL Registration Modal */}
      <Modal show={showRegisterModal} onHide={() => setShowRegisterModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Register User</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {message.text && <Alert variant={message.type}>{message.text}</Alert>}
          <Form onSubmit={handleRegisterSubmit}>
            <Form.Group controlId="username">
              <Form.Label>Username</Form.Label>
              <Form.Control
                type="text"
                placeholder="Enter username"
                value={formData.username}
                onChange={(e) => 
                  setFormData({ ...formData, username: e.target.value })
                }
                required
              />
            </Form.Group>

            <Form.Group controlId="broker">
              <Form.Label>Broker</Form.Label>
              <Form.Select
                value={formData.broker}
                onChange={(e) => 
                  setFormData({ ...formData, broker: e.target.value })
                }
              >
                <option value="Angel">Angel</option>
                <option value="Zerodha">Zerodha</option>
              </Form.Select>
            </Form.Group>

            <Form.Group controlId="api_key">
              <Form.Label>API Key</Form.Label>
              <Form.Control
                type="text"
                placeholder="Enter API Key"
                value={formData.api_key}
                onChange={(e) => 
                  setFormData({ ...formData, api_key: e.target.value })
                }
                required
              />
            </Form.Group>

            <Form.Group controlId="totp_token">
              <Form.Label>TOTP Token</Form.Label>
              <Form.Control
                type="text"
                placeholder="Enter TOTP Token"
                value={formData.totp_token}
                onChange={(e) => 
                  setFormData({ ...formData, totp_token: e.target.value })
                }
                required
              />
            </Form.Group>

            <Form.Group controlId="default_quantity">
              <Form.Label>Default Quantity</Form.Label>
              <Form.Control
                type="number"
                placeholder="Enter Quantity"
                value={formData.default_quantity}
                onChange={(e) => 
                  setFormData({ ...formData, default_quantity: e.target.value })
                }
                required
              />
            </Form.Group>

            <Button variant="primary" type="submit" className="mt-3">
              Register
            </Button>
          </Form>
        </Modal.Body>
      </Modal>
    </>
  );
};

export default Landing;
